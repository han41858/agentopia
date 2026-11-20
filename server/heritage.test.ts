import assert from 'node:assert/strict';
import { test } from 'node:test';
import { githubResponse } from './github.ts';
import { onePerPageCount } from './heritage.ts';
import { heritageTier } from '../src/heritage-scale.ts';

test('history distinguishes observed zero, unknown totals and capped visual growth', () => {
  assert.equal(onePerPageCount(0, false, null), 0);
  assert.equal(
    onePerPageCount(
      1,
      true,
      '<https://api.github.com/items?page=2>; rel="next"',
    ),
    undefined,
  );
  assert.equal(
    onePerPageCount(
      1,
      true,
      '<https://api.github.com/items?page=999>; rel="last"',
    ),
    999,
  );
  assert.equal(heritageTier('resolvedIssues', undefined), 0);
  assert.equal(heritageTier('resolvedIssues', 25), 2);
  assert.equal(heritageTier('comments', 25), 1);
  assert.equal(heritageTier('comments', 10_000_000), 5);
});

test('public heritage uses one-item aggregates, omits incomplete results and reuses cache', async (context) => {
  const fetch = context.mock.method(
    globalThis,
    'fetch',
    async (input: string) => {
      const url = new URL(input);
      assert.equal(url.origin, 'https://api.github.com');
      assert.equal(url.searchParams.get('per_page'), '1');
      if (url.pathname === '/search/issues') {
        const q = url.searchParams.get('q');
        assert.match(q ?? '', /^repo:example\/heritage /);
        return Response.json({
          total_count: q?.endsWith('is:merged') ? 0 : 15,
          incomplete_results: q?.endsWith('reason:completed') === true,
          items: [{ state: 'closed', state_reason: 'completed' }],
        });
      }
      if (url.pathname.endsWith('/issues/comments'))
        return Response.json([{}], {
          headers: {
            link: '<https://api.github.com/comments?page=2>; rel="next", <https://api.github.com/comments?page=150>; rel="last"',
          },
        });
      assert.ok(url.pathname.endsWith('/pulls/comments'));
      return Response.json([{}]);
    },
  );
  const url = new URL(
    'https://agentopia.test/api/github?repo=example/heritage&heritage=1',
  );
  const exact = {
    mergedPulls: { count: 0, source: 'search' },
    comments: { count: 151, source: 'github' },
  };
  assert.deepEqual(JSON.parse((await githubResponse(url, 'GET')).body), exact);
  assert.deepEqual(JSON.parse((await githubResponse(url, 'GET')).body), exact);
  assert.equal(fetch.mock.callCount(), 4);
});

test('authenticated heritage uses repository counts and never publishes truncated conversation totals', async (context) => {
  const fetch = context.mock.method(
    globalThis,
    'fetch',
    async (input: string, options: RequestInit) => {
      const url = new URL(input);
      assert.equal(
        new Headers(options.headers).get('authorization'),
        'Bearer heritage_token',
      );
      if (url.pathname === '/search/issues') {
        assert.equal(
          url.searchParams.get('q'),
          'repo:example/large is:issue is:closed reason:completed',
        );
        return Response.json({
          total_count: 14,
          incomplete_results: false,
          items: [{ state: 'closed', state_reason: 'completed' }],
        });
      }
      if (url.pathname === '/graphql') {
        const query = JSON.parse(String(options.body));
        assert.deepEqual(query.variables, { owner: 'example', name: 'large' });
        assert.match(query.query, /pullRequests\(states: MERGED\)/);
        return Response.json({
          data: {
            repository: {
              pulls: {
                totalCount: 60_000,
                nodes: [{ reviews: { totalCount: 4 } }],
              },
              mergedPulls: { totalCount: 25_000 },
            },
          },
        });
      }
      if (url.pathname.endsWith('/issues/comments'))
        return Response.json([{}], {
          headers: {
            link: '<https://api.github.com/comments?page=2>; rel="next", <https://api.github.com/comments?page=30000>; rel="last"',
          },
        });
      if (url.pathname.endsWith('/pulls/comments')) return Response.json([]);
      throw new Error('Unexpected repository request');
    },
  );
  const url = new URL(
    'https://agentopia.test/api/github?repo=example/large&heritage=1',
  );
  const response = await githubResponse(url, 'GET', 'Bearer heritage_token');
  assert.deepEqual(JSON.parse(response.body), {
    resolvedIssues: { count: 14, source: 'search' },
    mergedPulls: { count: 25_000, source: 'github' },
  });
  assert.equal(fetch.mock.callCount(), 4);
});

test('counts submitted reviews when all PRs fit and rejects a non-completed issue result', async (context) => {
  context.mock.method(
    globalThis,
    'fetch',
    async (input: string, options: RequestInit) => {
      const url = new URL(input);
      if (url.pathname === '/search/issues')
        return Response.json({
          total_count: 9,
          incomplete_results: false,
          items: [{ state: 'closed', state_reason: 'not_planned' }],
        });
      if (url.pathname === '/graphql') {
        const { query } = JSON.parse(String(options.body));
        assert.match(
          query,
          /reviews\(states: \[APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED\]\)/,
        );
        return Response.json({
          data: {
            repository: {
              mergedPulls: { totalCount: 1 },
              pulls: {
                totalCount: 2,
                nodes: [
                  { reviews: { totalCount: 3 } },
                  { reviews: { totalCount: 4 } },
                ],
              },
            },
          },
        });
      }
      return Response.json([]);
    },
  );
  const response = await githubResponse(
    new URL('https://agentopia.test/api/github?repo=example/small&heritage=1'),
    'GET',
    'Bearer heritage_token',
  );
  assert.deepEqual(JSON.parse(response.body), {
    mergedPulls: { count: 1, source: 'github' },
    reviews: { count: 7, source: 'github' },
    comments: { count: 0, source: 'github' },
  });
});
