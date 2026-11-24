import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  linkedPullIssues,
  makeForges,
  makePullQuests,
  makeQuests,
  readState,
  repositoryInput,
  repositoryRegion,
  runIssue,
} from './model.ts';
import type { Comment, Issue, Pull, Report, Run } from './model.ts';
import { githubResponse } from './github.ts';
import { facilityKind, isCurrentFacility } from '../src/facility-kind.ts';

const commitTrail = repositoryRegion('han41858/commit-trail');
const videx = repositoryRegion('han41858/videx');
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
  region: string = 'commit-trail',
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

test('issue Actions use run start times and distinguish status from conclusion', () => {
  const startedAt = '2026-11-19T10:05:00Z';
  const runs = [
    run(1, { status: 'queued', run_started_at: null }),
    run(1, { status: 'in_progress', run_started_at: startedAt }),
    ...['success', 'failure', 'cancelled', 'skipped'].map((conclusion) =>
      run(1, { status: 'completed', conclusion, run_started_at: startedAt }),
    ),
    run(1, { status: 'completed' }),
  ].map((item, index) => ({
    ...item,
    id: 200 - index,
    html_url: `https://github.com/${commitTrail.slug}/actions/runs/${200 - index}`,
  }));
  const [quest] = makeQuests(
    commitTrail,
    [issue(1)],
    [],
    runs,
    [],
    new Map(),
    [],
  );

  assert.deepEqual(
    quest.runs.map((item) => item.status),
    [
      'queued',
      'in_progress',
      'success',
      'failure',
      'cancelled',
      'skipped',
      'completed',
    ],
  );
  assert.deepEqual(
    quest.runs.map((item) => item.startedAt),
    [
      undefined,
      startedAt,
      startedAt,
      startedAt,
      startedAt,
      startedAt,
      undefined,
    ],
  );
});

test('GitHub workflow run metadata survives the issue report API', async (context) => {
  const slug = 'example/actions-report';
  const startedAt = '2026-11-19T10:05:00Z';
  const workflowRun = run(1, {
    status: 'completed',
    conclusion: 'failure',
    run_started_at: startedAt,
    html_url: `https://github.com/${slug}/actions/runs/101`,
  });
  const fetch = context.mock.method(
    globalThis,
    'fetch',
    async (url: RequestInfo | URL) => {
      switch (new URL(url instanceof Request ? url.url : url).pathname) {
        case `/repos/${slug}/issues`:
          return Response.json([
            { ...issue(1), html_url: `https://github.com/${slug}/issues/1` },
          ]);
        case `/repos/${slug}/pulls`:
        case `/repos/${slug}/issues/comments`:
          return Response.json([]);
        case `/repos/${slug}/actions/runs`:
          return Response.json({ workflow_runs: [workflowRun] });
        default:
          throw new Error(`Unexpected GitHub request: ${url}`);
      }
    },
  );
  const result = await githubResponse(
    new URL(`https://example.test/api/github?repo=${slug}&history=cached`),
    'GET',
    'Bearer mock_actions_report_token',
  );

  assert.equal(result.status, 200);
  assert.ok(
    fetch.mock.calls.some(
      ({ arguments: [url] }) =>
        new URL(url instanceof Request ? url.url : url).pathname ===
        `/repos/${slug}/actions/runs`,
    ),
  );
  const report = JSON.parse(result.body) as Report;
  assert.deepEqual(report.warnings, []);
  const [quest] = report.quests;
  assert.equal(quest.number, 1);
  assert.deepEqual(
    quest.runs.map(({ url, status, startedAt }) => ({
      url,
      status,
      startedAt,
    })),
    [{ url: workflowRun.html_url, status: 'failure', startedAt }],
  );
});

test('independent parties retain hierarchy and reflect actual developer and reviewer roles', () => {
  const quests = makeQuests(
    commitTrail,
    [issue(1), issue(2), issue(3)],
    [pull],
    [run(3), run(2), run(1)],
    [
      comment(1, 'developing', { developer: 'codex' }),
      comment(2, 'reviewing', { reviewer: 'codex' }),
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
      ['developing', 'codex', undefined, undefined],
      ['reviewing', 'claude', 'codex', 1],
      ['failed', 'claude', undefined, undefined],
    ],
  );
  assert.equal(quests[2].reason, 'verification failed');
  assert.equal(quests[1].pulls[0].number, 20);
});

test('monster lifecycle and adventurer activity are independent and use matching workflow attempts', () => {
  const work = makeQuests(
    commitTrail,
    [issue(1), issue(2), issue(3), issue(4), issue(5), issue(6), issue(7)],
    [],
    [
      run(1),
      run(2),
      run(3, { status: 'completed', conclusion: 'success' }),
      run(4, { status: 'queued' }),
      run(5, { run_attempt: 2 }),
      run(7),
    ],
    [
      comment(1, 'developing', { developer: 'claude' }),
      comment(2, 'reviewing', {
        developer: 'claude',
        reviewer: 'codex',
        reviewInProgress: sha,
      }),
      comment(3, 'developing', { developer: 'claude' }),
      comment(4, 'queued', { developer: 'codex' }),
      comment(5, 'developing', { developer: 'codex', attempt: 1 }),
      comment(7, 'revising', { developer: 'codex' }),
    ],
    new Map([[2, 1]]),
    [],
  );
  assert.deepEqual(
    work.map(({ stage }) => stage),
    [
      'developing',
      'reviewing',
      'returned',
      'queued',
      'developing',
      'idle',
      'revising',
    ],
  );
  assert.deepEqual(
    work.map(({ adventurers }) =>
      adventurers?.map(({ agent, active }) => [agent, active]),
    ),
    [
      [['claude', 'develop']],
      [
        ['claude', undefined],
        ['codex', 'review'],
      ],
      [['claude', undefined]],
      [],
      [],
      [],
      [['codex', 'develop']],
    ],
  );
  assert.equal(work[1].parent, 1);
});

test('a merged PR is a victory independently of whether its monster has been defeated', () => {
  const merged = {
    ...pull,
    state: 'closed',
    merged_at: stamp,
    merge_commit_sha: mergeSha,
  };
  const [open, closed] = makeQuests(
    commitTrail,
    [issue(2), { ...issue(8), state: 'closed', state_reason: 'completed' }],
    [merged],
    [],
    [],
    new Map(),
    [],
  );
  assert.equal(open.state, 'open');
  assert.equal(open.victory, true);
  assert.equal(open.pulls[0].status, 'merged');
  assert.equal(closed.state, 'closed');
  assert.equal(closed.stage, 'idle');
  assert.equal(closed.victory, false);
  const [independent] = makePullQuests(
    commitTrail,
    [{ ...merged, head: { ...pull.head, ref: 'independent' } }],
    [],
    new Set([2, 8]),
    new Map(),
  );
  assert.equal(independent.merged, true);
  assert.equal(independent.stage, 'complete');
});

test('uses a verified non-base commit as an issue result when a PR does not exist', () => {
  const [withCommit, onBase] = makeQuests(
    commitTrail,
    [issue(1), issue(2)],
    [],
    [run(1), run(2)],
    [
      comment(1, 'developing', { base: mergeSha }),
      comment(2, 'developing', { base: sha }),
    ],
    new Map(),
    [],
  );
  assert.deepEqual(withCommit.commit, {
    title: `커밋 ${sha.slice(0, 7)}`,
    url: `https://github.com/${commitTrail.slug}/commit/${sha}`,
  });
  assert.equal(onBase.commit, undefined);
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
    [
      {
        ...pull,
        state: 'closed',
        merge_commit_sha: mergeSha,
        merged_at: stamp,
      },
    ],
    [],
    [comment(2, 'merged')],
    new Map(),
    [
      { title: 'Unrelated', url: 'https://github.com', stage: 'complete', sha },
      {
        title: 'Production',
        url: 'https://github.com',
        stage: 'complete',
        sha: mergeSha,
      },
    ],
  );
  assert.equal(quest.stage, 'complete');
  assert.equal(quest.released, true);
  assert.equal(quest.evidence?.title, 'Production');
});

test('only a trusted checkpoint establishes an unexplained request for human input', () => {
  const checkpoint = comment(74, 'needs_human', { reason: '...' });
  assert.equal(
    readState({ ...checkpoint, body: 'needs_human' }, commitTrail),
    undefined,
  );
  assert.equal(
    readState({ ...checkpoint, user: { login: 'contributor' } }, commitTrail),
    undefined,
  );
  const [quest] = makeQuests(
    commitTrail,
    [issue(74)],
    [
      {
        ...pull,
        number: 75,
        state: 'closed',
        merged_at: stamp,
        head: { ...pull.head, ref: 'fix/label' },
        body: '#74의 라벨 자동화 개선',
      },
    ],
    [run(74, { status: 'completed', conclusion: 'success' })],
    [checkpoint],
    new Map(),
    [],
  );
  assert.equal(quest.state, 'open');
  assert.equal(quest.stage, 'attention');
  assert.match(quest.reason ?? '', /구체적인 중단 사유가 없습니다/);
  assert.equal(quest.victory, false);
  assert.deepEqual(quest.pulls, []);
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
  const url = new URL('http://localhost/api/github?repo=han41858%2Fvidex');
  assert.equal((await githubResponse(url, 'POST')).status, 405);
  assert.equal(
    (await githubResponse(url, 'GET', 'Basic anything')).status,
    400,
  );
  url.searchParams.set('repo', 'unexpected');
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
      if (path === '/graphql') {
        const body = JSON.parse(String(options.body));
        assert.deepEqual(body.variables, { owner: 'han41858', name: 'videx' });
        assert.match(body.query, /TAG_COMMIT_DATE/);
        return Response.json({
          data: {
            repository: { refs: { nodes: [] }, releases: { nodes: [] } },
          },
        });
      }
      if (path.endsWith('/issues')) return Response.json([issue(1)]);
      if (path.endsWith('/actions/runs'))
        return Response.json({ workflow_runs: [] });
      if (path.endsWith('/pulls')) return Response.json([], { status: 403 });
      return Response.json([]);
    },
  );
  const url = new URL('http://localhost/api/github?repo=han41858%2Fvidex');
  const authenticated = await githubResponse(url, 'GET', 'Bearer test_token');
  const publicReport = await githubResponse(url, 'GET');
  assert.equal(authenticated.status, 200);
  assert.equal(publicReport.status, 200);
  assert.deepEqual(JSON.parse(publicReport.body).warnings, ['PR']);
  assert.equal(calls.length, 12);
  assert.ok(
    calls.every(
      ({ url }) =>
        url === 'https://api.github.com/graphql' ||
        url.startsWith('https://api.github.com/repos/han41858/videx/'),
    ),
  );
  assert.ok(
    calls
      .slice(0, 6)
      .every(({ authorization }) => authorization === 'Bearer test_token'),
  );
  assert.ok(
    calls.slice(6).every(({ authorization }) => authorization === null),
  );
});

test('accepts GitHub repository URLs and validates dynamic repository access', async (context) => {
  assert.equal(
    repositoryInput('https://github.com/Example/Project.git/'),
    'example/project',
  );
  assert.equal(repositoryInput('example/a.b'), 'example/a.b');
  assert.equal(
    repositoryInput('https://github.com.evil.test/example/project'),
    undefined,
  );
  assert.equal(
    repositoryInput('https://github.com/example/project/issues/1'),
    undefined,
  );
  assert.equal(repositoryInput('example/..'), undefined);
  const authorized: (string | null)[] = [];
  const mock = context.mock.method(
    globalThis,
    'fetch',
    async (input: string, options: RequestInit) => {
      const url = new URL(input);
      const token = new Headers(options.headers).get('authorization');
      assert.equal(url.origin, 'https://api.github.com');
      authorized.push(token);
      if (url.pathname === '/repos/example/project') {
        if (!token) return Response.json({}, { status: 404 });
        return Response.json({ full_name: 'Example/Project', private: true });
      }
      if (url.pathname.endsWith('/issues')) {
        return Response.json([], {
          status: token === 'Bearer no_issues' ? 403 : 200,
        });
      }
      if (url.pathname.endsWith('/reviews')) {
        return Response.json([
          {
            user: { login: 'reviewer' },
            state: 'APPROVED',
            html_url: 'https://github.com/example/project/pull/1',
          },
        ]);
      }
      return Response.json({ full_name: 'Example/Public', private: false });
    },
  );

  const url = new URL('http://localhost/api/github?repository=1');
  url.searchParams.set('repo', 'https://other.example/project');
  assert.equal((await githubResponse(url, 'GET')).status, 400);
  assert.equal(mock.mock.callCount(), 0);

  url.searchParams.set('repo', 'Example/Public');
  assert.deepEqual(JSON.parse((await githubResponse(url, 'GET')).body), {
    slug: 'example/public',
    private: false,
  });
  url.searchParams.set('repo', 'Example/Project');
  assert.equal((await githubResponse(url, 'GET')).status, 404);
  assert.equal(
    (await githubResponse(url, 'GET', 'Bearer no_issues')).status,
    403,
  );
  for (let request = 0; request < 2; request++) {
    const result = await githubResponse(url, 'GET', 'Bearer valid');
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.body), {
      slug: 'example/project',
      private: true,
    });
  }
  assert.equal(
    authorized.filter((token) => token === 'Bearer valid').length,
    4,
  );
  url.searchParams.delete('repository');
  url.searchParams.set('reviews', '1');
  const reviews = await githubResponse(url, 'GET', 'Bearer valid');
  assert.equal(JSON.parse(reviews.body)[0].title, 'reviewer');
});

test('does not infer a reviewer for repositories without a known review policy', () => {
  const region = repositoryRegion('example/project');
  const [quest] = makeQuests(
    region,
    [issue(1)],
    [],
    [],
    [comment(1, 'reviewing', { developer: 'codex' }, 'project')],
    new Map(),
    [],
  );
  assert.equal(quest.developer, 'codex');
  assert.equal(quest.reviewer, undefined);
});

test('standalone PRs exclude issue-linked and closed PRs and use verified actor and CI evidence', () => {
  const direct = {
    ...pull,
    number: 12,
    draft: false,
    body: null,
    user: { login: 'chatgpt-codex-connector[bot]' },
    head: { ...pull.head, ref: 'feature/direct' },
  };
  const byBody = { ...direct, number: 13, body: 'Fixes #2' };
  const byNative = { ...direct, number: 14 };
  const human = {
    ...direct,
    number: 15,
    draft: true,
    body: 'Discussion about #2 and `Fixes #2`',
    user: { login: 'claude', type: 'User' },
    head: { ...direct.head, sha: mergeSha },
  };
  const links = new Map([
    [14, { issues: [2] }],
    [12, { issues: [], reviewer: 'claude' as const, review: 'APPROVED' }],
  ]);
  assert.deepEqual(linkedPullIssues(byBody, commitTrail), [2]);
  assert.deepEqual(linkedPullIssues(human, commitTrail), []);
  const ci = run(2, {
    path: '.github/workflows/ci.yml',
    head_sha: sha,
    head_branch: 'feature/direct',
    pull_requests: [{ number: 12 }],
  });
  const quests = makePullQuests(
    commitTrail,
    [
      pull,
      direct,
      byBody,
      byNative,
      human,
      { ...direct, number: 16, state: 'closed' },
    ],
    [ci],
    new Set([2]),
    links,
  );
  assert.deepEqual(
    quests.map(({ number, stage, author, reviewer }) => [
      number,
      stage,
      author,
      reviewer,
    ]),
    [
      [12, 'ci', 'codex', 'claude'],
      [15, 'idle', undefined, undefined],
    ],
  );
  assert.deepEqual(
    makeQuests(
      commitTrail,
      [issue(2)],
      [pull, direct, byBody, byNative],
      [],
      [],
      new Map(),
      [],
      links,
    )[0].pulls.map(({ number }) => number),
    [pull.number, 13, 14],
  );
});

test('lists public or token-visible repositories for one owner without exposing unrelated slugs', async (context) => {
  const fetch = context.mock.method(
    globalThis,
    'fetch',
    async (input: string, options: RequestInit) => {
      const url = new URL(input);
      assert.equal(url.origin, 'https://api.github.com');
      if (url.pathname === '/graphql') {
        assert.equal(
          new Headers(options.headers).get('authorization'),
          'Bearer account_token',
        );
        const body = JSON.parse(String(options.body));
        assert.match(body.query, /isArchived: false/);
        assert.deepEqual(body.variables, {
          owner: 'example',
          cursor: 'next=',
        });
        return Response.json({
          data: {
            repositoryOwner: {
              repositories: {
                nodes: [
                  {
                    nameWithOwner: 'Example/Private',
                    isPrivate: true,
                    visibility: 'PRIVATE',
                  },
                ],
                pageInfo: { hasNextPage: true, endCursor: 'next2=' },
              },
            },
          },
        });
      }
      assert.equal(url.pathname, '/users/example/repos');
      if (url.searchParams.get('page') === '2')
        return Response.json(
          Array.from({ length: 50 }, (_, index) => ({
            full_name: `Example/Archive-${index}`,
            private: false,
            archived: true,
          })),
        );
      return Response.json([
        { full_name: 'Example/Public', private: false },
        { full_name: 'Example/Old', private: false, archived: true },
        { full_name: 'Elsewhere/Public', private: false },
        { full_name: 'Example/Private', private: true },
      ]);
    },
  );
  const url = new URL('http://localhost/api/github?owner=Example');
  assert.deepEqual(JSON.parse((await githubResponse(url, 'GET')).body), {
    repositories: [{ slug: 'example/public', private: false }],
  });
  url.searchParams.set('cursor', 'next=');
  assert.equal((await githubResponse(url, 'GET')).status, 400);
  assert.deepEqual(
    JSON.parse((await githubResponse(url, 'GET', 'Bearer account_token')).body),
    {
      repositories: [{ slug: 'example/private', private: true }],
      next: 'next2=',
    },
  );
  url.searchParams.set('cursor', '2');
  assert.deepEqual(JSON.parse((await githubResponse(url, 'GET')).body), {
    repositories: [],
    next: '3',
  });
  assert.equal(fetch.mock.callCount(), 3);
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
  const url = new URL(
    'http://localhost/api/github?repo=han41858%2Fcommit-trail',
  );
  await githubResponse(url, 'GET');
  now += 10_000;
  await githubResponse(url, 'GET');
  assert.equal(issueRequests, 1);
  url.searchParams.set('refresh', '1');
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

test('activity counts follow verified links and failed actors follow the matching run attempt', () => {
  const linked = { ...pull, number: 21, body: 'Closes #2' };
  const unknown = {
    ...pull,
    number: 22,
    body: 'Closes #3',
    head: { ...pull.head, ref: 'feature/without-counts' },
  };
  const [knownQuest, unknownQuest] = makeQuests(
    commitTrail,
    [
      { ...issue(2), comments: 3 },
      { ...issue(3), comments: 0 },
    ],
    [pull, linked, unknown],
    [
      run(2, { status: 'completed', conclusion: 'failure' }),
      run(3, { run_attempt: 2, status: 'completed', conclusion: 'failure' }),
    ],
    [comment(2, 'developing'), comment(3, 'developing')],
    new Map(),
    [],
    new Map([
      [
        20,
        {
          issues: [2],
          activity: {
            shas: [sha, mergeSha],
            commits: 2,
            comments: 1,
            reviews: 0,
            people: ['Alice'],
            complete: true,
            opinion: { state: 'APPROVED', at: '2026-11-19T00:00:00Z' },
          },
        },
      ],
      [
        21,
        {
          issues: [2],
          activities: { commits: 2, comments: 2, reviews: 3 },
          activity: {
            shas: [sha, 'c'.repeat(40)],
            commits: 2,
            comments: 2,
            reviews: 3,
            people: ['alice', 'Bob'],
            complete: true,
            opinion: { state: 'CHANGES_REQUESTED', at: '2026-11-20T00:00:00Z' },
          },
        },
      ],
    ]),
  );
  assert.equal(knownQuest.activity?.commits, 3);
  assert.equal(knownQuest.activity?.partialCommits, false);
  assert.equal(knownQuest.activity?.issueComments, 3);
  assert.equal(knownQuest.activity?.pullComments, 3);
  assert.equal(knownQuest.activity?.reviews, 3);
  assert.equal(knownQuest.activity?.participants, 3);
  assert.equal(knownQuest.activity?.partialParticipants, true);
  assert.equal(knownQuest.activity?.opinion?.state, 'CHANGES_REQUESTED');
  assert.deepEqual(knownQuest.pulls[1].activities, {
    commits: 2,
    comments: 2,
    reviews: 3,
  });
  assert.equal(knownQuest.adventurers?.[0].fallen, true);
  assert.equal(knownQuest.adventurers?.[0].active, undefined);
  assert.equal(unknownQuest.activities?.commits, undefined);
  assert.equal(unknownQuest.activities?.comments, 0);
  assert.equal(unknownQuest.adventurers?.[0]?.fallen, undefined);
});

test('activity detail requests stay on the validated GitHub resource and omit unpublished reviews', async (context) => {
  const link = 'https://github.com/example/project/pull/23#pullrequestreview-1';
  const get = context.mock.method(
    globalThis,
    'fetch',
    async (input: string, options: RequestInit) => {
      const url = new URL(input);
      assert.equal(url.origin, 'https://api.github.com');
      assert.equal(
        new Headers(options.headers).get('authorization'),
        'Bearer activity_token',
      );
      assert.equal(url.searchParams.get('per_page'), '30');
      assert.equal(url.searchParams.get('page'), '2');
      switch (url.pathname) {
        case '/repos/example/project/pulls/23/reviews':
          return Response.json([
            {
              user: { login: 'agent' },
              html_url: link,
              state: 'APPROVED',
              body: 'Looks good\n<!-- hidden -->',
              submitted_at: stamp,
            },
            { state: 'PENDING', body: 'Unpublished' },
          ]);
        case '/repos/example/project/pulls/23/commits':
          return Response.json([
            { sha, html_url: link, commit: { message: 'Implement change' } },
          ]);
        case '/repos/example/project/issues/23/comments':
          return Response.json([
            {
              user: { login: 'maintainer' },
              html_url: link,
              body: 'Discuss change',
              created_at: stamp,
            },
          ]);
        default:
          throw new Error('Unexpected GitHub resource');
      }
    },
  );
  const requestActivity = (kind: string, number = '23') =>
    githubResponse(
      new URL(
        `https://agentopia.test/api/github?repo=example/project&activity=${kind}&number=${number}&page=2`,
      ),
      'GET',
      'Bearer activity_token',
    );
  assert.equal((await requestActivity('reviews', '%2F23')).status, 400);
  assert.equal(get.mock.callCount(), 0);
  const [reviews, commits, comments] = await Promise.all(
    ['reviews', 'commits', 'comments'].map((kind) => requestActivity(kind)),
  );
  assert.deepEqual(JSON.parse(reviews.body), {
    entries: [
      {
        title: 'agent',
        url: link,
        status: 'APPROVED',
        body: 'Looks good',
        at: stamp,
      },
    ],
  });
  assert.equal(JSON.parse(commits.body).entries[0].body, 'Implement change');
  assert.equal(JSON.parse(comments.body).entries[0].body, 'Discuss change');
});

test('forges represent many-to-many links and activate only the uniquely matched PR head', () => {
  const second = {
    ...pull,
    number: 21,
    body: 'Closes #2 and closes #3',
    head: { ...pull.head, ref: 'feature/shared', sha: mergeSha },
  };
  const independent = {
    ...pull,
    number: 24,
    head: { ...pull.head, ref: 'feature/independent' },
  };
  const pulls = [pull, second, independent];
  const workflow = run(2);
  const records = [
    comment(2, 'reviewing', {
      reviewer: 'codex',
      head: mergeSha,
      reviewInProgress: mergeSha,
    }),
  ];
  const quests = makeQuests(
    commitTrail,
    [issue(2), issue(3)],
    pulls,
    [workflow],
    records,
    new Map(),
    [],
  );
  assert.equal(quests[0].workPull, 21);
  const forges = makeForges(commitTrail, pulls, [workflow], new Map(), quests);
  assert.deepEqual(
    forges.map(({ number }) => number),
    [20, 21, 24],
  );
  assert.deepEqual(forges[1].issues, [2, 3]);
  assert.equal(forges[1].stage, 'reviewing');
  assert.equal(
    forges[1].adventurers?.find((member) => member.agent === 'codex')?.active,
    'review',
  );
  assert.deepEqual(
    forges[1].adventurers?.find((member) => member.agent === 'claude'),
    { agent: 'claude', roles: ['develop'] },
  );
  assert.equal(forges[0].adventurers?.length, 0);
  assert.deepEqual(forges[2].issues, []);
  const ambiguous = [...pulls, { ...second, number: 22 }];
  const ambiguousQuests = makeQuests(
    commitTrail,
    [issue(2)],
    ambiguous,
    [workflow],
    records,
    new Map(),
    [],
  );
  assert.equal(ambiguousQuests[0].workPull, undefined);
  assert.ok(
    makeForges(
      commitTrail,
      ambiguous,
      [workflow],
      new Map(),
      ambiguousQuests,
    ).every((forge) => !forge.adventurers?.length),
  );
});

test('completed reviews keep resting reviewers on the reviewed PR and its issues', () => {
  const links = new Map([
    [20, { issues: [2], reviewParticipants: ['claude' as const] }],
  ]);
  const reviewed = { ...pull, head: { ...pull.head, ref: 'feature/work' } };
  const unrelated = { ...reviewed, number: 21 };
  const quests = makeQuests(
    commitTrail,
    [issue(2)],
    [reviewed, unrelated],
    [],
    [],
    new Map(),
    [],
    links,
  );
  const [forge, other] = makeForges(
    commitTrail,
    [reviewed, unrelated],
    [],
    links,
    quests,
  );
  const resting = [{ agent: 'claude', roles: ['review'] }];
  assert.deepEqual(quests[0].adventurers, resting);
  assert.deepEqual(forge.adventurers, resting);
  assert.equal(forge.stage, 'idle');
  assert.deepEqual(other.adventurers, []);
});

test('facility classification uses the leading GitMoji and keeps a neutral default', () => {
  assert.deepEqual(
    ['✨', '🐛', '💄', '📝', '✅', '⚡️', '♻️', '🔒', '🚀'].map((emoji) =>
      facilityKind(`  ${emoji} Change`),
    ),
    [
      'forge',
      'wall',
      'garden',
      'library',
      'training',
      'machine',
      'repair',
      'guard',
      'portal',
    ],
  );
  assert.equal(facilityKind('👷 CI'), 'control');
  assert.equal(facilityKind('📦 Dependencies'), 'supply');
  assert.equal(facilityKind('📈 Analytics'), 'observatory');
  assert.equal(facilityKind('✨🐛 Mixed'), 'forge');
  assert.equal(facilityKind('🎨 Ordinary title ✨'), 'workshop');
  assert.equal(facilityKind('Ordinary title'), 'workshop');
  assert.equal(facilityKind(''), 'workshop');
});

test('closed facilities go to history immediately and reopened facilities return', () => {
  const closed = { ...pull, state: 'closed', closed_at: stamp };
  const merged = { ...closed, number: 21, merged_at: stamp };
  const reopened = { ...closed, number: 22, state: 'open' };
  const [cancelled, completed, current] = makeForges(
    commitTrail,
    [closed, merged, reopened],
    [],
    new Map(),
  );
  assert.equal(cancelled.finishedAt, stamp);
  assert.equal(completed.finishedAt, stamp);
  assert.deepEqual([cancelled, completed, current].filter(isCurrentFacility), [
    current,
  ]);
  assert.equal(current.finishedAt, undefined);
});

test('Agentopia shows a reviewed draft in CI until the reviewed PR is merged', () => {
  const region = repositoryRegion('han41858/agentopia');
  const proposal = {
    ...pull,
    head: {
      ...pull.head,
      ref: 'ai/issue-2-codex',
      repo: { full_name: 'han41858/agentopia' },
    },
  };
  const state = comment(2, 'ready', { developer: 'codex' }, 'agentopia');
  const automation = run(2, { status: 'completed', conclusion: 'success' });
  const stage = (candidate: Pull) =>
    makeQuests(
      region,
      [issue(2)],
      [candidate],
      [automation],
      [state],
      new Map(),
      [],
    )[0].stage;
  assert.equal(stage(proposal), 'ci');
  assert.equal(
    stage({ ...proposal, state: 'closed', merged_at: stamp }),
    'complete',
  );
});

test('an old failed CI does not replace a current recovery checkpoint', () => {
  const [quest] = makeQuests(
    commitTrail,
    [issue(2)],
    [pull],
    [
      run(2),
      run(2, {
        path: '.github/workflows/ci.yml',
        id: 500,
        head_sha: mergeSha,
        pull_requests: [{ number: pull.number }],
        html_url: 'https://github.com/example/actions/runs/500',
        head_branch: pull.head.ref,
        status: 'completed',
        conclusion: 'failure',
      }),
    ],
    [comment(2, 'recovering', { reason: '최신 기준 반영 중' })],
    new Map(),
    [],
  );
  assert.equal(quest.stage, 'revising');
  assert.equal(quest.reason, '최신 기준 반영 중');
  assert.ok(quest.adventurers?.every((member) => !member.active));
  assert.ok(
    quest.runs.some(
      (item) => item.url.endsWith('/500') && item.status === 'failure',
    ),
  );
});
