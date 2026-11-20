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
