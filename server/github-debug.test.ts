import assert from 'node:assert/strict';
import { test } from 'node:test';
import { githubDebugSnapshot, recordCoreUsage } from './github-debug.ts';
import { githubGet } from './github-query.ts';
import { githubResponse } from './github.ts';

test('debug counts real requests, expires its rolling window, and only reports Core quota', async (context) => {
  context.mock.method(console, 'debug', () => {});
  const previous = process.env.AGENTOPIA_GITHUB_DEBUG;
  process.env.AGENTOPIA_GITHUB_DEBUG = '1';
  context.after(() => {
    if (previous === undefined) delete process.env.AGENTOPIA_GITHUB_DEBUG;
    else process.env.AGENTOPIA_GITHUB_DEBUG = previous;
  });
  let now = 1_800_000_000_000;
  context.mock.method(Date, 'now', () => now);
  const headers = {
    etag: '"debug-test"',
    'x-ratelimit-resource': 'core',
    'x-ratelimit-limit': '5000',
    'x-ratelimit-used': '2340',
    'x-ratelimit-remaining': '2660',
    'x-ratelimit-reset': String(now / 1000 + 3600),
  };
  const fetch = context.mock.method(
    globalThis,
    'fetch',
    async (_url: string, init: RequestInit) =>
      new Headers(init.headers).has('If-None-Match')
        ? new Response(null, { status: 304, headers })
        : Response.json([], { headers }),
  );
  const get = (ttl: number) =>
    githubGet(
      'https://api.github.com/repos/example/debug/metadata',
      'example/debug',
      undefined,
      {},
      ttl,
      async () => {},
    );
  await Promise.all([get(0), get(0)]);
  await get(10_000);
  assert.equal(githubDebugSnapshot('public').requestsPerSecond, 1 / 60);
  now += 30_000;
  await get(0);
  assert.equal(fetch.mock.callCount(), 2);
  recordCoreUsage(
    'public',
    new Headers({
      ...headers,
      'x-ratelimit-resource': 'graphql',
      'x-ratelimit-used': '5',
    }),
  );
  const url = new URL('https://agentopia.test/api/github?debug=usage');
  const result = JSON.parse((await githubResponse(url, 'GET')).body);
  assert.equal(result.requestsPerSecond, 2 / 60);
  assert.equal(result.core.used, 2340);
  assert.deepEqual(
    JSON.parse((await githubResponse(url, 'GET', 'Bearer other_token')).body),
    { requestsPerSecond: 0 },
  );
  now += 30_000;
  assert.equal(githubDebugSnapshot('public').requestsPerSecond, 1 / 60);
  now += 3_540_000;
  assert.deepEqual(githubDebugSnapshot('public'), {
    requestsPerSecond: 0,
    core: undefined,
  });
  delete process.env.AGENTOPIA_GITHUB_DEBUG;
  assert.equal((await githubResponse(url, 'GET')).status, 404);
  assert.equal(fetch.mock.callCount(), 2);
});
