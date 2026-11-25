import assert from 'node:assert/strict';
import { test } from 'node:test';
import { githubResponse } from './github.ts';
import { measureRefresh } from './github-debug.ts';

test('authenticated reports validate each list and preserve independent activity lookups', async (t) => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const old = process.env.AGENTOPIA_REFRESH_CACHE_KEY;
  process.env.AGENTOPIA_REFRESH_CACHE_KEY =
    'test-only-32-byte-signing-key-for-reports';
  t.after(() => {
    if (old === undefined) delete process.env.AGENTOPIA_REFRESH_CACHE_KEY;
    else process.env.AGENTOPIA_REFRESH_CACHE_KEY = old;
  });
  const repo = 'example/large';
  const url = new URL(
    'https://app.test/api/github?repo=' +
      repo +
      '&history=cached&measure=refresh',
  );
  const calls: { path: string; etag: string | null; status: number }[] = [];
  let version = 1;
  let denied = false;
  let reviewRequests = 0;
  let reviews = 0;
  const base = 'https://github.com/' + repo;
  const issue = {
    number: 1,
    title: 'Parent',
    html_url: base + '/issues/1',
    state: 'open',
    comments: 1,
    labels: [],
    sub_issues_summary: { total: 1 },
  };
  const pull = {
    number: 3,
    title: 'Topic',
    state: 'open',
    html_url: base + '/pull/3',
    body: 'Closes #8',
    head: { ref: 'topic', sha: 'abc' },
    updated_at: '2026-11-01T00:00:00Z',
  };
  t.mock.method(
    globalThis,
    'fetch',
    async (input: string, init: RequestInit) => {
      const path = new URL(input).pathname.replace('/repos/' + repo, '');
      if (path === '/graphql') {
        if (String(init.body).includes('refs/tags/'))
          return Response.json({
            data: {
              repository: {
                refs: { nodes: [] },
                releases: { nodes: [], pageInfo: { hasNextPage: false } },
              },
            },
          });
        reviewRequests++;
        return Response.json({
          data: {
            repository: {
              pullRequests: {
                nodes: [
                  {
                    number: 3,
                    reviews: { totalCount: reviews },
                    closingIssuesReferences: { nodes: [] },
                    latestReviews: { nodes: [] },
                  },
                ],
              },
            },
          },
        });
      }
      const etag = new Headers(init.headers).get('if-none-match');
      const tag = '"' + (path === '/issues/comments' ? version : 1) + '"';
      const status =
        denied && path === '/issues' ? 403 : etag === tag ? 304 : 200;
      calls.push({ path, etag, status });
      if (status === 403)
        return Response.json({ message: 'permission denied' }, { status });
      if (status === 304) return new Response(null, { status });
      let body: unknown;
      switch (path) {
        case '/issues':
          body = [issue];
          break;
        case '/pulls':
          body = [pull];
          break;
        case '/actions/runs':
          body = { workflow_runs: [] };
          break;
        case '/issues/comments':
          {
            const state = Buffer.from(
              JSON.stringify({
                issue: 1,
                runId: 77,
                status: version === 1 ? 'developing' : 'needs_human',
                reason: 'updated checkpoint',
              }),
            ).toString('base64');
            body = [
              {
                issue_url: 'https://api.github.com/repos/' + repo + '/issues/1',
                html_url: base + '/issues/1#issuecomment-1',
                user: { login: 'github-actions[bot]' },
                body: '<!-- large-ai-state:' + state + ' -->',
                updated_at: new Date(now).toISOString(),
              },
            ];
          }
          break;
        case '/issues/1/sub_issues':
          body = [];
          break;
        case '/issues/8':
          body = { ...issue, number: 8, sub_issues_summary: undefined };
          break;
        default:
          throw Error(path);
      }
      return Response.json(body, {
        headers: {
          etag: tag,
          'x-ratelimit-resource': 'core',
          'x-ratelimit-limit': '5000',
        },
      });
    },
  );
  async function refresh(ticket = '', token = 'Bearer fixture') {
    calls.length = 0;
    const { result, usage } = await measureRefresh(() =>
      githubResponse(url, ticket ? 'POST' : 'GET', token, ticket),
    );
    return { status: result.status, data: JSON.parse(result.body), usage };
  }
  const baselineStart = performance.now();
  await measureRefresh(() => githubResponse(url, 'GET', 'Bearer fixture'));
  const baselineMs = performance.now() - baselineStart;
  assert.equal(calls.length, 6);
  reviewRequests = 0;
  const cold = await refresh();
  assert.equal(cold.status, 200);
  assert.ok(cold.data.refreshTicket);
  assert.equal(calls.length, 6);
  assert.equal(cold.usage.consumed, 6);
  const warmStart = performance.now();
  const warm = await refresh(cold.data.refreshTicket);
  t.diagnostic(
    JSON.stringify({
      baselineMs,
      warmMs: performance.now() - warmStart,
      uploadBytes: Buffer.byteLength(cold.data.refreshTicket),
    }),
  );
  assert.equal(warm.status, 200);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((c) => c.status === 304));
  assert.equal(warm.usage.consumed, 0);
  assert.equal(reviewRequests, 2);
  assert.deepEqual(warm.data.quests, cold.data.quests);
  reviews++;
  const reviewOnly = await refresh(warm.data.refreshTicket);
  assert.ok(calls.every((c) => c.status === 304));
  assert.equal(reviewOnly.data.forges[0].activities.reviews, 1);
  version++;
  const edited = await refresh(warm.data.refreshTicket);
  assert.equal(
    edited.data.quests.find((q: { number: number }) => q.number === 1).stage,
    'attention',
  );
  assert.deepEqual(
    calls.filter((c) => c.status === 200).map((c) => c.path),
    ['/issues/comments'],
  );
  now += 61_000;
  await refresh(edited.data.refreshTicket);
  assert.ok(calls.some((c) => c.path === '/issues/8'));
  assert.ok(!calls.some((c) => c.path.endsWith('sub_issues')));
  url.searchParams.set('refresh', '1');
  await refresh(warm.data.refreshTicket);
  assert.equal(calls.length, 6);
  for (const [ticket, token] of [
    [warm.data.refreshTicket, 'Bearer different'],
    ['invalid', 'Bearer fixture'],
    ['', 'Bearer fixture'],
  ]) {
    await refresh(ticket, token);
    assert.ok(calls.every((c) => c.etag === null));
  }
  denied = true;
  const revoked = await refresh(warm.data.refreshTicket);
  assert.equal(revoked.status, 403);
  assert.equal(revoked.data.quests, undefined);
  assert.equal(revoked.data.refreshTicket, undefined);
});
