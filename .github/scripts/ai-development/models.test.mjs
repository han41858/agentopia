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
