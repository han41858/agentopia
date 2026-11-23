import assert from 'node:assert/strict';
import { test } from 'node:test';
import { githubGet } from './github-query.ts';
import { githubResponse } from './github.ts';
import { nextRefreshInterval, refreshDue } from '../src/refresh.ts';

test('public lookups merge concurrent callers, honor TTL, and reuse data and pagination on 304', async (context) => {
  let now = 1_800_000_000_000;
  context.mock.method(Date, 'now', () => now);
  const url = 'https://api.github.com/repos/example/cache/pulls?page=2';
  const fetch = context.mock.method(
    globalThis,
    'fetch',
    async (_input: string, options: RequestInit) => {
      const headers = new Headers(options.headers);
      if (headers.get('if-none-match') === '"first"')
        return new Response(null, { status: 304 });
      return Response.json([{ number: 40 }], {
        headers: {
          etag: '"first"',
          link: '<https://not-used.test>; rel="next"',
        },
      });
    },
  );
  const get = (ttl = 0) =>
    githubGet(url, 'example/cache', undefined, {}, ttl, async (response) => {
      assert.equal(response.ok, true);
    });
  const [first, same] = await Promise.all([get(), get()]);
  assert.deepEqual(first, same);
  assert.equal(fetch.mock.callCount(), 1);
  now += 500;
  await get(1000);
  assert.equal(fetch.mock.callCount(), 1);
  now += 500;
  const result = await get(1000);
  assert.deepEqual(result.body, [{ number: 40 }]);
  assert.equal(result.next, true);
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal(result.checkedAt, now);
});

test('authenticated responses share only in-flight work and remain isolated by token', async (context) => {
  const url = 'https://api.github.com/repos/example/private/pulls/1';
  const fetch = context.mock.method(
    globalThis,
    'fetch',
    async (_input: string, options: RequestInit) => {
      const headers = new Headers(options.headers);
      assert.equal(headers.get('If-None-Match'), null);
      return Response.json(
        { identity: headers.get('Authorization') },
        { headers: { etag: '"same"' } },
      );
    },
  );
  const get = (token: string) =>
    githubGet(
      url,
      'example/private',
      token,
      { Authorization: token },
      60000,
      async () => {},
    );
  const [first, duplicate, other] = await Promise.all([
    get('one'),
    get('one'),
    get('two'),
  ]);
  assert.deepEqual(first, duplicate);
  assert.notDeepEqual(first.body, other.body);
  assert.equal(fetch.mock.callCount(), 2);
  await get('one');
  assert.equal(fetch.mock.callCount(), 3);
});

test('a permission 403 does not suppress other public repositories and is distinct from rate limits', async (context) => {
  context.mock.method(globalThis, 'fetch', async (input: string) => {
    const path = new URL(input).pathname;
    if (path.includes('/permission/'))
      return Response.json(
        { message: 'Resource not accessible' },
        { status: 403 },
      );
    if (path.includes('/limited/'))
      return Response.json(
        { message: 'API rate limit exceeded' },
        { status: 403 },
      );
    if (path.endsWith('/actions/runs'))
      return Response.json({ workflow_runs: [] });
    return Response.json([]);
  });
  const target = (repo: string) =>
    new URL(`https://agentopia.test/api/github?repo=example/${repo}`);
  const permission = await githubResponse(target('permission'), 'GET');
  assert.equal(permission.status, 403);
  assert.match(permission.body, /권한/);
  assert.equal((await githubResponse(target('healthy'), 'GET')).status, 200);
  const limited = await githubResponse(
    target('limited'),
    'GET',
    'Bearer checked_token',
  );
  assert.equal(limited.status, 403);
  assert.match(limited.body, /한도/);
});

test('quiet intervals back off independently and active or changed work restores the base interval', () => {
  const base = 20_000;
  let quiet = nextRefreshInterval(base, base, false, false);
  assert.equal(quiet, 30_000);
  quiet = nextRefreshInterval(base, quiet, false, false);
  assert.equal(quiet, 45_000);
  assert.equal(nextRefreshInterval(base, quiet, true, false), base);
  assert.equal(nextRefreshInterval(base, quiet, false, true), base);
  assert.equal(nextRefreshInterval(base, 300_000, false, false), 300_000);
  assert.equal(refreshDue(1_000, base, false), 21_000);
  assert.equal(refreshDue(1_000, base, true), 181_000);
});

test('release history uses published releases and excludes drafts and workflow runs', async (context) => {
  const workflow_runs = ['success', 'failure', 'skipped'].map(
    (conclusion, id) => ({
      id,
      updated_at: `2026-11-22T0${id}:00:00Z`,
      name: 'Production release',
      path: '.github/workflows/production-release.yml',
      html_url: `https://github.com/example/release-history/actions/runs/${id}`,
      status: 'completed',
      conclusion,
    }),
  );
  const release = {
    tag_name: 'v1',
    html_url: 'https://github.com/example/release-history/releases/tag/v1',
    published_at: '2026-11-22T02:00:00Z',
    draft: false,
    prerelease: false,
  };
  context.mock.method(globalThis, 'fetch', async (input: string) => {
    const path = new URL(input).pathname;
    if (path.endsWith('/actions/runs')) return Response.json({ workflow_runs });
    if (path.endsWith('/git/commits/abc'))
      return Response.json({ committer: { date: release.published_at } });
    if (path.endsWith('/tags'))
      return Response.json(
        ['v1', 'tag-only'].map((name) => ({ name, commit: { sha: 'abc' } })),
      );
    if (path.endsWith('/releases'))
      return Response.json([
        { ...release, draft: true },
        { ...release, published_at: null },
        {
          ...release,
          tag_name: 'v2-beta',
          prerelease: true,
          published_at: '2026-11-23T02:00:00Z',
        },
        release,
      ]);
    return Response.json([]);
  });
  const response = await githubResponse(
    new URL('https://agentopia.test/api/github?repo=example/release-history'),
    'GET',
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    JSON.parse(response.body).tags,
    ['v1', 'tag-only'].map((name) => ({
      name,
      committedAt: release.published_at,
    })),
  );
  assert.deepEqual(JSON.parse(response.body).releases, [
    {
      title: 'v2-beta',
      url: release.html_url,
      status: '사전 릴리스',
      at: '2026-11-23T02:00:00Z',
      stage: 'complete',
    },
    {
      title: 'v1',
      url: release.html_url,
      status: '릴리스',
      at: release.published_at,
      stage: 'complete',
    },
  ]);
});
