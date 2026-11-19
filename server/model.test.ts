import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeQuests, readState, regions, runIssue } from './model.ts';
import type { Comment, Issue, Pull, Run } from './model.ts';
import { githubResponse } from './github.ts';

const [commitTrail, videx] = regions;
const sha = 'a'.repeat(40);
const mergeSha = 'b'.repeat(40);
const stamp = '2026-11-19T10:00:00Z';
const issue = (number: number): Issue => ({
  number,
  state: 'open',
  title: `Issue ${number}`,
  html_url: `https://github.com/han41858/commit-trail/issues/${number}`,
  labels: [],
});
const run = (number: number, overrides: Partial<Run> = {}): Run => ({
  id: number + 100,
  run_attempt: 1,
  path: '.github/workflows/ai-development.yml',
  name: 'AI development',
  display_title: `AI development for Issue #${number}`,
  status: 'in_progress',
  conclusion: null,
  html_url: `https://github.com/han41858/commit-trail/actions/runs/${number + 100}`,
  head_sha: sha,
  head_branch: 'dev',
  event: 'issues',
  created_at: stamp,
  updated_at: stamp,
  pull_requests: [],
  ...overrides,
});
const pull: Pull = {
  number: 20,
  state: 'open',
  title: 'Issue implementation',
  html_url: 'https://github.com/han41858/commit-trail/pull/20',
  draft: true,
  body: '',
  head: {
    ref: 'ai/issue-2-claude',
    sha,
    repo: { full_name: 'han41858/commit-trail' },
  },
  updated_at: stamp,
};
const comment = (
  number: number,
  status: string,
  extras: Record<string, unknown> = {},
  region: string = commitTrail.id,
): Comment => ({
  body: `<!-- ${region}-ai-state:${Buffer.from(
    JSON.stringify({
      issue: number,
      developer: 'claude',
      runId: number + 100,
      attempt: 1,
      head: sha,
      status,
      ...extras,
    }),
  ).toString('base64')} -->`,
  user: { login: 'github-actions[bot]' },
  issue_url: `https://api.github.com/repos/han41858/${region}/issues/${number}`,
  html_url: `https://github.com/han41858/${region}/issues/${number}#issuecomment-11`,
  updated_at: stamp,
});

test('independent parties retain hierarchy and reflect actual developer and reviewer roles', () => {
  const quests = makeQuests(
    commitTrail,
    [issue(1), issue(2), issue(3)],
    [pull],
    [run(3), run(2), run(1)],
    [
      comment(1, 'developing', { developer: 'codex' }),
      comment(2, 'reviewing'),
      comment(3, 'failed', { reason: 'verification failed' }),
    ],
    new Map([[2, 1]]),
    [],
  );
  assert.deepEqual(
    quests.map(({ stage, developer, reviewer, parent }) => [
      stage,
      developer,
      reviewer,
      parent,
    ]),
    [
      ['developing', 'codex', 'claude', undefined],
      ['reviewing', 'claude', 'codex', 1],
      ['failed', 'claude', 'codex', undefined],
    ],
  );
  assert.equal(quests[2].reason, 'verification failed');
  assert.equal(quests[1].pulls[0].number, 20);
});

test('a new attempt suppresses old state, and unauthored or unrelated state is ignored', () => {
  const record = comment(2, 'needs_human');
  assert.equal(
    readState({ ...record, user: { login: 'someone' } }, commitTrail),
    undefined,
  );
  assert.equal(readState(record, videx), undefined);
  assert.equal(
    runIssue(run(2, { path: '.github/workflows/ci.yml' })),
    undefined,
  );
  const [quest] = makeQuests(
    commitTrail,
    [issue(2)],
    [],
    [run(2, { run_attempt: 2, status: 'queued' })],
    [record],
    new Map(),
    [],
  );
  assert.equal(quest.stage, 'queued');
  assert.equal(quest.reason, undefined);
});

test('failed CI requires matching HEAD and deployment requires matching merge SHA', () => {
  const ci = run(80, {
    name: 'CI',
    path: '.github/workflows/ci.yml',
    head_branch: pull.head.ref,
    status: 'completed',
    conclusion: 'failure',
  });
  const record = comment(2, 'reviewing', {
    reviews: [{ head: sha, result: { status: 'pass' } }],
  });
  const make = (candidate: Run) =>
    makeQuests(
      commitTrail,
      [issue(2)],
      [pull],
      [candidate, run(2)],
      [record],
      new Map(),
      [],
    )[0];
  assert.equal(make(ci).stage, 'failed');
  assert.equal(make(ci).review, 'pass');
  assert.equal(make({ ...ci, head_sha: mergeSha }).stage, 'reviewing');
  const [quest] = makeQuests(
    commitTrail,
    [issue(2)],
    [{ ...pull, state: 'closed', merge_commit_sha: mergeSha }],
    [],
    [comment(2, 'merged')],
    new Map(),
    [
      { title: 'Unrelated', url: 'https://github.com', stage: 'failed', sha },
      {
        title: 'Production',
        url: 'https://github.com',
        stage: 'deploying',
        sha: mergeSha,
      },
    ],
  );
  assert.equal(quest.stage, 'deploying');
  assert.equal(quest.evidence?.title, 'Production');
});

test('intervention preserves the bot reason and a stopped issue is explicit', () => {
  const cancelled = run(2, { status: 'completed', conclusion: 'cancelled' });
  const [quest, stopped] = makeQuests(
    commitTrail,
    [issue(2), { ...issue(3), labels: [{ name: 'ai:stop' }] }],
    [],
    [cancelled],
    [comment(2, 'needs_human', { reason: 'human review required' })],
    new Map(),
    [],
  );
  assert.equal(quest.stage, 'attention');
  assert.equal(quest.reason, 'human review required');
  assert.equal(stopped.evidence?.status, 'ai:stop');
});

test('API rejects mutations and unknown repositories before contacting GitHub', async (context) => {
  const fetch = context.mock.method(globalThis, 'fetch', () => {
    throw new Error('unexpected fetch');
  });
  const url = new URL('http://localhost/api/github?region=videx');
  assert.equal((await githubResponse(url, 'POST')).status, 405);
  assert.equal(
    (await githubResponse(url, 'GET', 'Basic anything')).status,
    400,
  );
  url.searchParams.set('region', 'unexpected');
  assert.equal((await githubResponse(url, 'GET')).status, 400);
  assert.equal(fetch.mock.callCount(), 0);
});

test('API gets only the allowed repository and keeps authenticated reports out of the public cache', async (context) => {
  const calls: { url: string; authorization: string | null }[] = [];
  context.mock.method(
    globalThis,
    'fetch',
    async (url: string, options: RequestInit) => {
      const path = new URL(url).pathname;
      calls.push({
        url,
        authorization: new Headers(options.headers).get('authorization'),
      });
      if (path.endsWith('/issues')) return Response.json([issue(1)]);
      if (path.endsWith('/actions/runs'))
        return Response.json({ workflow_runs: [] });
      if (path.endsWith('/pulls')) return Response.json([], { status: 403 });
      return Response.json([]);
    },
  );
  const url = new URL('http://localhost/api/github?region=videx');
  const authenticated = await githubResponse(url, 'GET', 'Bearer test_token');
  const publicReport = await githubResponse(url, 'GET');
  assert.equal(authenticated.status, 200);
  assert.equal(publicReport.status, 200);
  assert.deepEqual(JSON.parse(publicReport.body).warnings, ['PR']);
  assert.equal(calls.length, 10);
  assert.ok(
    calls.every(({ url }) =>
      url.startsWith('https://api.github.com/repos/han41858/videx/'),
    ),
  );
  assert.ok(
    calls
      .slice(0, 5)
      .every(({ authorization }) => authorization === 'Bearer test_token'),
  );
  assert.ok(
    calls.slice(5).every(({ authorization }) => authorization === null),
  );
});

test('public refresh reuses recent reports, refreshes on demand, and honors rate limits', async (context) => {
  let now = 1_800_000_000_000;
  let issueRequests = 0;
  let limited = false;
  context.mock.method(Date, 'now', () => now);
  context.mock.method(globalThis, 'fetch', async (url: string) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/issues')) {
      issueRequests++;
      if (limited)
        return Response.json(
          {},
          {
            status: 429,
            headers: { 'retry-after': '90' },
          },
        );
      return Response.json([issue(1)]);
    }
    if (path.endsWith('/actions/runs'))
      return Response.json({ workflow_runs: [] });
    return Response.json([]);
  });
  const url = new URL('http://localhost/api/github?region=commit-trail');
  await githubResponse(url, 'GET');
  url.searchParams.set('refresh', '1');
  now += 10_000;
  await githubResponse(url, 'GET');
  assert.equal(issueRequests, 1);
  now += 5_000;
  await githubResponse(url, 'GET');
  assert.equal(issueRequests, 2);
  url.searchParams.delete('refresh');
  now += 59_000;
  await githubResponse(url, 'GET');
  assert.equal(issueRequests, 2);
  now += 1_000;
  limited = true;
  assert.equal((await githubResponse(url, 'GET')).status, 429);
  assert.equal(issueRequests, 3);
  limited = false;
  now += 20_000;
  url.searchParams.set('refresh', '1');
  const stale = await githubResponse(url, 'GET');
  assert.equal(stale.status, 200);
  assert.deepEqual(JSON.parse(stale.body).warnings, ['GitHub API 사용 한도']);
  assert.equal(issueRequests, 3);
  now += 70_000;
  await githubResponse(url, 'GET');
  assert.equal(issueRequests, 4);
});
