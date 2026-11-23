import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withCachedHistory } from '../src/snapshot.ts';
import type { Report } from './model.ts';
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
    if (path.endsWith('/commits'))
      return Response.json([
        { sha: 'abc', commit: { committer: { date: release.published_at } } },
      ]);
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
      sha: 'abc',
      url: release.html_url,
      status: '릴리스',
      at: release.published_at,
      stage: 'complete',
    },
  ]);
});

test('anonymous history bounds date and release lookups when the tag page is full', async (context) => {
  const paths: string[] = [];
  const tags = Array.from({ length: 30 }, (_, i) => ({
    name: 'tag-' + i,
    commit: { sha: 'sha-' + i },
  }));
  context.mock.method(globalThis, 'fetch', async (url: string) => {
    const path = new URL(url).pathname.replace('/repos/example/full-page', '');
    paths.push(path);
    if (path === '/tags')
      return Response.json(tags, {
        headers: { link: '<https://api.github.com/next>; rel="next"' },
      });
    if (path === '/commits') {
      const params = new URL(url).searchParams;
      assert.equal(params.get('per_page'), '100');
      const sha = params.get('sha');
      assert.ok(sha === 'refs/tags/old/3' || sha === 'sha-0');
      return Response.json([
        {
          sha: sha === 'refs/tags/old/3' ? 'merged' : sha,
          commit: { committer: { date: '2026-11-10T00:00:00Z' } },
        },
      ]);
    }
    if (path === '/releases')
      return Response.json(
        [1, 2, 3].map((i) => ({
          tag_name: 'old/' + i,
          html_url: 'https://github.com/example/full-page/releases',
          published_at: '2026-11-0' + i + 'T00:00:00Z',
          draft: false,
        })),
      );
    if (path === '/pulls')
      return Response.json([
        {
          number: 1,
          state: 'closed',
          head: { sha: 'head', ref: 'topic' },
          merge_commit_sha: 'merged',
          merged_at: '2026-11-01T00:00:00Z',
          body: '',
          title: 'feature',
        },
      ]);
    if (path === '/commits/refs%2Ftags%2Fold%2F3')
      return Response.json({ sha: 'merged' });
    if (path === '/actions/runs') return Response.json({ workflow_runs: [] });
    return Response.json([]);
  });
  const res = await githubResponse(
    new URL('https://agentopia.test/api/github?repo=example/full-page'),
    'GET',
  );
  assert.equal(res.status, 200);
  const report = JSON.parse(res.body);
  assert.equal(report.tagsPartial, true);
  assert.equal(report.tags.length, 30);
  assert.ok(!report.warnings.includes('태그 커밋 시각'));
  assert.equal(report.tags[0].committedAt, '2026-11-10T00:00:00Z');
  assert.equal(report.tags[2].committedAt, undefined);
  assert.equal(report.releases[0].sha, 'merged');
  assert.deepEqual(
    paths.filter(
      (p) =>
        p === '/commits' ||
        p.startsWith('/git/commits/') ||
        p.startsWith('/commits/'),
    ),
    ['/commits', '/commits', '/commits/refs%2Ftags%2Fold%2F3'],
  );
});

test('authenticated history accepts annotated tags and skips history calls when the tab has a fresh copy', async (context) => {
  const paths: string[] = [];
  context.mock.method(globalThis, 'fetch', async (url: string) => {
    const path = new URL(url).pathname;
    paths.push(path);
    if (path === '/graphql')
      return Response.json({
        data: {
          repository: {
            refs: {
              nodes: [
                {
                  name: 'annotated',
                  target: {
                    target: {
                      oid: 'commit',
                      committedDate: '2026-11-10T00:00:00Z',
                    },
                  },
                },
              ],
            },
            releases: { nodes: [] },
          },
        },
      });
    if (path.endsWith('/actions/runs'))
      return Response.json({ workflow_runs: [] });
    return Response.json([]);
  });
  const url = new URL(
    'https://agentopia.test/api/github?repo=example/annotated',
  );
  const load = async () =>
    JSON.parse((await githubResponse(url, 'GET', 'Bearer checked_token')).body);
  const initial = await load();
  assert.deepEqual(initial.tags, [
    { name: 'annotated', committedAt: '2026-11-10T00:00:00Z' },
  ]);
  paths.length = 0;
  url.searchParams.set('history', 'cached');
  await load();
  assert.ok(
    !paths.includes('/graphql') &&
      !paths.some((path) => path.endsWith('/releases')),
  );
  url.searchParams.set('refresh', '1');
  await load();
  assert.ok(
    paths.includes('/graphql') &&
      paths.some((path) => path.endsWith('/releases')),
  );
});

test('cached publication evidence follows the current merged PRs', () => {
  const published = {
    title: 'v1',
    url: 'https://example.com/v1',
    stage: 'complete' as const,
    status: '릴리스',
    sha: 'merged',
  };
  const previous: Report = {
    quests: [],
    releases: [published],
    tags: [{ name: 'tag' }],
    warnings: [],
    updatedAt: '',
  };
  const quest = {
    number: 1,
    title: 'issue',
    url: '',
    state: 'open' as const,
    stage: 'complete' as const,
    pulls: [{ number: 2, title: 'PR', url: '', mergeSha: 'merged' }],
    runs: [],
  };
  const fresh: Report = {
    ...previous,
    releases: [],
    tags: [],
    quests: [quest, { ...quest, number: 3, pulls: [] }],
  };
  const result = withCachedHistory(fresh, previous);
  assert.deepEqual(result.releases, [published]);
  assert.deepEqual(result.tags, previous.tags);
  assert.equal(result.quests[0].evidence?.url, published.url);
  assert.equal(result.quests[1].released, undefined);
});

test('a failed tag ancestry request preserves tags and reports a lookup warning', async (context) => {
  let attempts = 0;
  context.mock.method(globalThis, 'fetch', async (input: string) => {
    const path = new URL(input).pathname;
    if (path.endsWith('/tags'))
      return Response.json(
        ['a', 'b'].map((sha) => ({ name: sha, commit: { sha } })),
      );
    if (path.endsWith('/commits')) {
      attempts++;
      return Response.json({ message: 'unavailable' }, { status: 503 });
    }
    if (path.endsWith('/actions/runs'))
      return Response.json({ workflow_runs: [] });
    return Response.json([]);
  });
  const result = await githubResponse(
    new URL('https://agentopia.test/api/github?repo=example/tag-date-error'),
    'GET',
  );
  const report = JSON.parse(result.body);
  assert.equal(result.status, 200);
  assert.deepEqual(report.tags, [{ name: 'a' }, { name: 'b' }]);
  assert.ok(report.warnings.includes('태그 커밋 시각'));
  assert.equal(attempts, 1);
});

test('anonymous ancestry starts at the most recently published tag even if it is last in the tag list', async (context) => {
  const names = ['old', 'middle', 'latest'];
  const anchors: string[] = [];
  context.mock.method(globalThis, 'fetch', async (input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/tags'))
      return Response.json(
        names.map((name) => ({ name, commit: { sha: 'sha-' + name } })),
      );
    if (url.pathname.endsWith('/releases'))
      return Response.json([
        { tag_name: 'old', published_at: '2026-11-01T00:00:00Z', draft: false },
        {
          tag_name: 'latest',
          published_at: '2026-11-20T00:00:00Z',
          draft: false,
        },
        {
          tag_name: 'draft',
          published_at: '2026-11-22T00:00:00Z',
          draft: true,
        },
      ]);
    if (url.pathname.endsWith('/commits')) {
      anchors.push(url.searchParams.get('sha')!);
      return Response.json(
        names.map((name, i) => ({
          sha: 'sha-' + name,
          commit: { committer: { date: `2026-11-0${i + 1}T00:00:00Z` } },
        })),
      );
    }
    if (url.pathname.endsWith('/actions/runs'))
      return Response.json({ workflow_runs: [] });
    return Response.json([]);
  });
  const result = await githubResponse(
    new URL('https://agentopia.test/api/github?repo=example/release-anchor'),
    'GET',
  );
  assert.deepEqual(anchors, ['sha-latest']);
  assert.ok(
    JSON.parse(result.body).tags.every(
      (tag: { committedAt?: string }) => tag.committedAt,
    ),
  );
});
