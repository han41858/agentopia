import assert from 'node:assert/strict';
import test from 'node:test';
import { progressBody } from './journal.mjs';

test('one comment retains a failed run through review, merge, close and late CI delivery', () => {
  const first = {
    issue: 194,
    runId: 50,
    attempt: 1,
    pullNumber: 196,
    status: 'needs_human',
    reason: '테스트 실패',
  };
  const second = {
    ...first,
    runId: 51,
    status: 'reviewing',
    reason: '검토 중',
  };
  const done = { ...second, status: 'merged', reason: '이슈 종료 확인' };
  const ci = {
    key: 'ci:80/2',
    text: 'UI 검사 실패',
    ci: { id: 80, run_attempt: 2 },
  };
  const legacy =
    first.reason +
    '\n\n<!-- agentopia-ai-state:' +
    Buffer.from(JSON.stringify(first)).toString('base64') +
    ' -->';
  let body = progressBody({ body: legacy, state: first, event: ci });
  body = progressBody({
    body,
    state: second,
    event: { key: 'review', text: '리뷰 승인', reviewId: 42 },
  });
  body = progressBody({
    body,
    state: second,
    event: { key: 'merge', text: 'PR 머지 확인' },
  });
  body = progressBody({
    body,
    state: done,
    event: { key: 'close', text: done.reason },
  });
  assert.match(body, /^\*\*2차 실행 · 완료/);
  assert.match(
    body,
    /1차 실행[^]*테스트 실패[^]*UI 검사 실패[^]*2차 실행[^]*리뷰 승인[^]*PR 머지 확인[^]*이슈 종료 확인/,
  );
  assert.match(body, /pull\/196#issuecomment-42/);
  assert.match(body, /actions\/runs\/80\/attempts\/2/);
  assert.equal(
    progressBody({ body, state: done, eventState: first, event: ci }),
    body,
  );
  const late = progressBody({
    body,
    state: done,
    eventState: first,
    event: { key: 'late', text: '이전 시도 기록' },
  });
  assert.match(
    late,
    /^\*\*2차 실행 · 완료[^]*1차 실행[^]*이전 시도 기록[^]*### 2차 실행/,
  );
  const data = late.match(/<!-- agentopia-ai-state:(\S+) -->$/)[1];
  assert.deepEqual(JSON.parse(Buffer.from(data, 'base64')), done);
});
