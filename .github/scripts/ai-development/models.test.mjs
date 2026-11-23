import assert from 'node:assert/strict';
import { test } from 'node:test';
import { config } from './config.mjs';
import { createModels } from './models.mjs';

for (const agent of ['codex', 'claude']) {
  for (const budget of ['per turn', 'total']) {
    test(`${agent} enforces the ${budget} tool budget before reading more files`, async () => {
      let requests = 0;
      let reads = 0;
      const input = { query: 'model', offset: 0 };
      const count = budget === 'per turn' ? 3 : 2;
      const models = createModels({
        keys: { codex: 'mock', claude: 'mock' },
        modelNames: { codex: 'mock', claude: 'mock' },
        limits: { ...config.limits, toolCallsPerTurn: 2, toolCallsTotal: 3 },
        log: () => {},
        request: async () => {
          requests++;
          const calls = Array.from({ length: count }, (_, index) =>
            agent === 'codex'
              ? {
                  type: 'function_call',
                  name: 'list_files',
                  arguments: JSON.stringify(input),
                  call_id: String(index),
                }
              : {
                  type: 'tool_use',
                  name: 'list_files',
                  input,
                  id: String(index),
                },
          );
          return Response.json(
            agent === 'codex'
              ? { status: 'completed', output: calls }
              : { stop_reason: 'tool_use', content: calls },
          );
        },
      });
      await assert.rejects(
        models.run({
          agent,
          mode: 'development',
          instructions: 'Inspect source.',
          context: 'Test',
          inspect: () => {
            reads++;
            return 'server/model.ts';
          },
        }),
        /도구 호출 한도/,
      );
      assert.equal(requests, budget === 'per turn' ? 1 : 2);
      assert.equal(reads, budget === 'per turn' ? 0 : 2);
    });
  }
}

test('Claude replays the complete streamed signature and stable system prompt on tool continuation', async () => {
  let first;
  const models = createModels({
    keys: { claude: 'mock' },
    modelNames: { claude: 'mock' },
    log: () => {},
    request: async (_, options) => {
      const body = JSON.parse(options.body);
      if (first) {
        assert.equal(body.system, first.system);
        assert.deepEqual(body.messages[1].content[0], {
          type: 'thinking',
          thinking: 'test',
          signature: 'first-second',
        });
        return Response.json({
          stop_reason: 'end_turn',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'pass',
                summary: '검토 완료',
                findings: [],
              }),
            },
          ],
        });
      }
      first = body;
      const events = [
        { type: 'message_start', message: {} },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'test' },
        },
        ...['first-', 'second'].map((signature) => ({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature },
        })),
        { type: 'content_block_stop', index: 0 },
        {
          type: 'content_block_start',
          index: 1,
          content_block: {
            type: 'tool_use',
            name: 'list_files',
            id: 'tool',
            input: { query: 'src', offset: 0 },
          },
        },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
        { type: 'message_stop' },
      ];
      return new Response(
        events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  const review = await models.run({
    agent: 'claude',
    mode: 'review',
    instructions: 'Review',
    context: 'Test',
    inspect: () => 'src/file.ts',
  });
  assert.equal(review.status, 'pass');
});
