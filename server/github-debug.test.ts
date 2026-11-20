import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  githubDebugSnapshot,
  measureRefresh,
  recordCoreUsage,
  recordRefreshResponse,
} from './github-debug.ts';
import { githubGet } from './github-query.ts';

const headers = {
  etag: '"debug-test"',
  'x-ratelimit-resource': 'core',
  'x-ratelimit-limit': '5000',
  'x-ratelimit-used': '2340',
  'x-ratelimit-remaining': '2660',
  'x-ratelimit-reset': '1800003600',
};

test('isolates overlapping refreshes and only attributes issued requests', async (context) => {
  context.mock.method(console, 'debug', () => {});
  context.mock.method(Date, 'now', () => 1_800_000_000_000);
  const calls = context.mock.method(
    globalThis,
    'fetch',
    async (url: string, init: RequestInit) => {
      if (new Headers(init.headers).has('If-None-Match'))
        return new Response(null, { status: 304, headers });
      return Response.json([], {
        headers: {
          ...headers,
          'x-ratelimit-used': url.endsWith('other') ? '2378' : '2340',
        },
      });
    },
  );
  const get = (endpoint: string, ttl = 0) =>
    githubGet(
      `https://api.github.com/repos/example/debug/${endpoint}`,
      'example/debug',
      undefined,
      {},
      ttl,
      async () => {},
    );
  const [owner, concurrent, other] = await Promise.all([
    measureRefresh(() => get('report')),
    measureRefresh(() => get('report')),
    measureRefresh(() => get('other')),
  ]);
  assert.deepEqual(owner.usage, { consumed: 1, limit: 5000 });
  assert.deepEqual(concurrent.usage, { consumed: 0, limit: undefined });
  assert.deepEqual(other.usage, { consumed: 1, limit: 5000 });
  assert.equal(
    (await measureRefresh(() => get('report', 10000))).usage.consumed,
    0,
  );
  assert.equal(
    (await measureRefresh(() => get('report'))).usage.consumed,
    undefined,
  );
  assert.equal(calls.mock.callCount(), 3);
  recordCoreUsage(
    'public',
    new Headers({
      ...headers,
      'x-ratelimit-resource': 'graphql',
      'x-ratelimit-used': '5',
    }),
  );
  assert.equal(githubDebugSnapshot('public').core?.used, 2378);
});

test('excludes authenticated 304 and non-Core usage and leaves unclassified requests unknown', async () => {
  const exempt = await measureRefresh(async () => {
    recordRefreshResponse(new Response(null, { status: 304, headers }), true);
    recordRefreshResponse(
      new Response(null, {
        status: 200,
        headers: { 'x-ratelimit-resource': 'search' },
      }),
      true,
    );
  });
  assert.equal(exempt.usage.consumed, 0);
  const unknown = await measureRefresh(async () =>
    recordRefreshResponse(undefined, true),
  );
  assert.equal(unknown.usage.consumed, undefined);
});
