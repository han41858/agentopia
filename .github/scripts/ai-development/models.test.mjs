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

test('Claude corrects an invalid review using the same evidence before publication', async () => {
  let requests = 0;
  const models = createModels({
    keys: { claude: 'mock' },
    modelNames: { claude: 'mock' },
    log: () => {},
    request: async (_, options) => {
      requests++;
      const body = JSON.parse(options.body);
      if (requests === 2) {
        assert.equal(body.tool_choice.type, 'none');
        assert.match(body.messages.at(-1).content, /Validation/);
      }
      return Response.json({
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'pass',
              findings: [],
              summary:
                requests === 1 ? 'a'.repeat(1000) : '검토를 완료했습니다.',
            }),
          },
        ],
      });
    },
  });
  const review = await models.run({
    agent: 'claude',
    mode: 'review',
    context: 'Test',
    instructions: 'Review',
    inspect: () => '',
  });
  assert.equal(review.status, 'pass');
  assert.equal(requests, 2);
});

for (const correctionValid of [true, false]) {
  test(`Codex review allows one correction (valid: ${correctionValid})`, async () => {
    let requests = 0;
    let priorOutput;
    const models = createModels({
      keys: { codex: 'mock' },
      modelNames: { codex: 'mock' },
      log: () => {},
      request: async (_, options) => {
        const body = JSON.parse(options.body);
        requests++;
        assert.match(body.instructions, /at most 6 findings/);
        if (requests === 2) {
          assert.equal(body.tool_choice, 'none');
          assert.deepEqual(body.input.slice(1, -1), priorOutput);
          assert.match(
            body.input.at(-1).content,
            /same evidence and verdict.*Validation:/,
          );
        }
        const text = JSON.stringify({
          status: 'pass',
          findings: [],
          summary:
            correctionValid && requests === 2 ? '검토 완료' : 'a'.repeat(1000),
        });
        priorOutput = [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text }],
          },
        ];
        return Response.json({ status: 'completed', output: priorOutput });
      },
    });
    const result = models.run({
      agent: 'codex',
      mode: 'review',
      context: 'Test',
      instructions: 'Review',
      inspect: () => '',
    });
    if (correctionValid) assert.equal((await result).status, 'pass');
    else await assert.rejects(result);
    assert.equal(requests, 2);
  });
}

for (const status of ['needs_human', 'completed']) {
  test(`placeholder blocker requests clarification and preserves the stop on ${status}`, async () => {
    let calls = 0;
    const models = createModels({
      keys: { claude: 'mock' },
      modelNames: { claude: 'mock' },
      log: () => {},
      request: async (_, options) => {
        calls++;
        if (calls === 2)
          assert.equal(JSON.parse(options.body).tool_choice.type, 'none');
        return Response.json({
          stop_reason: 'end_turn',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: calls === 1 ? 'needs_human' : status,
                summary: calls === 1 ? '...' : '재현 조건을 알려 주세요.',
                title: '',
                edits: [],
              }),
            },
          ],
        });
      },
    });
    const result = await models.run({
      agent: 'claude',
      mode: 'development',
      instructions: 'Develop',
      context: 'Test',
      inspect: () => '',
    });
    assert.equal(calls, 2);
    assert.equal(result.status, 'needs_human');
    assert.match(
      result.summary,
      status === 'needs_human' ? /재현 조건/ : /중단 사유/,
    );
    assert.deepEqual(result.edits, []);
  });
}

for (const mode of ['development', 'review']) {
  for (const outcome of ['network', 'max_tokens', 'explained']) {
    test(`${mode} retains human decision after ${outcome} clarification`, async () => {
      let calls = 0;
      const models = createModels({
        keys: { claude: 'mock' },
        modelNames: { claude: 'mock' },
        log: () => {},
        request: async () => {
          calls++;
          if (calls === 2 && outcome === 'network') throw Error('offline');
          const result = {
            status: 'needs_human',
            summary: calls === 1 ? '…' : '대상 브랜치를 확인해 주세요.',
            ...(mode === 'review'
              ? { findings: [] }
              : { title: '', edits: [] }),
          };
          return Response.json({
            stop_reason:
              calls === 2 && outcome === 'max_tokens'
                ? 'max_tokens'
                : 'end_turn',
            content: [{ type: 'text', text: JSON.stringify(result) }],
          });
        },
      });
      const result = await models.run({
        agent: 'claude',
        mode,
        instructions: 'Verify',
        context: 'Test',
        inspect: () => '',
      });
      assert.equal(calls, 2);
      assert.equal(result.status, 'needs_human');
      assert.match(
        result.summary,
        outcome === 'explained' ? /브랜치/ : /중단 사유/,
      );
      assert.deepEqual(mode === 'review' ? result.findings : result.edits, []);
    });
  }
}

for (const [agent, summary, count, diagnostic, retryValid] of [
  ['claude', ' ', 1, /요약이 비어/, true],
  ['codex', '가'.repeat(1201), 1, /1201\/1200/, true],
  ['claude', '수정', 2, /2\/1/, false],
]) {
  test(`${agent} development corrects invalid output once: ${diagnostic}`, async () => {
    let calls = 0;
    const models = createModels({
      keys: { [agent]: 'mock' },
      modelNames: { [agent]: 'mock' },
      limits: { ...config.limits, edits: 1 },
      log: () => {},
      request: async (_, options) => {
        calls++;
        const body = JSON.parse(options.body);
        assert.match(body.instructions ?? body.system, /at most 1 exact edits/);
        if (calls === 2) {
          assert.equal(body.tool_choice.type ?? body.tool_choice, 'none');
          assert.match(
            (body.input ?? body.messages).at(-1).content,
            diagnostic,
          );
        }
        const valid = calls === 2 && retryValid;
        const text = JSON.stringify({
          status: 'completed',
          title: '🐛 화면: 팝업 수정',
          summary: valid ? '팝업을 수정했습니다.' : summary,
          edits: Array(valid ? 1 : count).fill({
            path: 'src/example.ts',
            before: 'a',
            after: 'b',
          }),
        });
        return Response.json(
          agent === 'codex'
            ? {
                status: 'completed',
                output: [
                  { type: 'message', content: [{ type: 'output_text', text }] },
                ],
              }
            : { stop_reason: 'end_turn', content: [{ type: 'text', text }] },
        );
      },
    });
    const result = models.run({
      agent,
      mode: 'development',
      instructions: 'Develop',
      context: 'Test',
      inspect: () => '',
    });
    if (retryValid) assert.equal((await result).edits.length, 1);
    else await assert.rejects(result, diagnostic);
    assert.equal(calls, 2);
  });
}

for (const repeat of [false, true]) {
  test(`Claude resumes a checkpoint once (repeated: ${repeat})`, async () => {
    let calls = 0;
    const models = createModels({
      keys: { claude: 'mock' },
      modelNames: { claude: 'mock' },
      log: () => {},
      request: async (_, options) => {
        calls++;
        if (calls === 2)
          assert.equal(JSON.parse(options.body).tool_choice, undefined);
        const result =
          calls === 1 || repeat
            ? {
                status: 'needs_human',
                summary: '(중간 확인 단계)',
                findings: [],
              }
            : { status: 'pass', summary: '검토 완료', findings: [] };
        return Response.json({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify(result) }],
        });
      },
    });
    const result = await models.run({
      agent: 'claude',
      mode: 'review',
      instructions: 'Review',
      context: 'Test',
      inspect: () => '',
    });
    assert.equal(calls, 2);
    assert.equal(result.status, repeat ? 'needs_human' : 'pass');
  });
}

for (const correctedVerdict of ['pass', 'changes_requested']) {
  test(`Claude keeps review findings during the reserved correction: ${correctedVerdict}`, async () => {
    const finding = {
      path: 'src/example.ts',
      line: 3,
      defect: '조건 누락',
      impact: '갱신 중단',
      evidence: '빈 목록에서 종료',
      fix: '빈 목록 처리',
    };
    let calls = 0;
    const models = createModels({
      keys: { claude: 'mock' },
      modelNames: { claude: 'mock' },
      limits: { ...config.limits, reviewTurns: 3 },
      log: () => {},
      request: async (_, options) => {
        calls++;
        const body = JSON.parse(options.body);
        if (calls === 1) {
          assert.equal(body.tool_choice, undefined);
          return Response.json({
            stop_reason: 'tool_use',
            content: [
              {
                type: 'tool_use',
                id: 'diff',
                name: 'read_diff',
                input: { line: 1 },
              },
            ],
          });
        }
        assert.equal(body.tool_choice.type, 'none');
        if (calls === 3)
          assert.match(body.messages.at(-1).content, /pass에 지적 사항/);
        const result = {
          status: calls === 2 ? 'pass' : correctedVerdict,
          summary: '검토 결과',
          findings: calls === 3 && correctedVerdict === 'pass' ? [] : [finding],
        };
        return Response.json({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify(result) }],
        });
      },
    });
    const result = models.run({
      agent: 'claude',
      mode: 'review',
      instructions: 'Review',
      context: 'Test',
      inspect: () => 'diff',
    });
    if (correctedVerdict === 'pass')
      await assert.rejects(result, /승인으로 변경/);
    else assert.deepEqual((await result).findings, [finding]);
    assert.equal(calls, 3);
  });
}
