import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withCachedHistory } from '../src/snapshot.ts';
import type { Report } from './model.ts';
import { getReport } from './github-report.ts';
import { githubGet } from './github-query.ts';
import { githubResponse } from './github.ts';
import { summarizeActivity } from './activity.ts';
import type { PullActivity } from './activity.ts';
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

test('popup counts request only their GitHub resources and keep unknown counts distinct from zero', async (context) => {
  const root = 'https://api.github.com/repos/example/popup-counts';
  const calls: string[] = [];
  const replies = new Map<string, unknown>([
    ['/pulls/1', { commits: 0, comments: 5 }],
    ['/pulls/1/reviews?per_page=100&page=1', [{ state: 'PENDING' }]],
    ['/issues/2', { comments: 0 }],
    ['/pulls/3', { commits: 2 }],
    ['/pulls/4', { commits: 3 }],
    ['/pulls/3/commits?per_page=100&page=1', [{ sha: 'a' }, { sha: 'b' }]],
    ['/pulls/4/commits?per_page=100&page=1', [{ sha: 'B' }, { sha: 'c' }]],
  ]);
  context.mock.method(globalThis, 'fetch', async (input: string) => {
    calls.push(input);
    const path = input.slice(root.length);
    assert.ok(input.startsWith(root) && replies.has(path), input);
    return Response.json(replies.get(path));
  });
  async function read(query: string, paths: string[]) {
    const url = new URL(
      `https://agentopia.test/api/github?repo=example/popup-counts&summary=${query}`,
    );
    const response = await githubResponse(url, 'GET');
    assert.deepEqual(
      calls.splice(0).sort(),
      paths.map((path) => root + path).sort(),
    );
    assert.equal(response.status, 200, response.body);
    return JSON.parse(response.body) as PullActivity;
  }
  const pull = await read('pull&number=1&counts=commits,comments', [
    '/pulls/1',
  ]);
  assert.equal(pull.commits, 0);
  assert.equal(pull.comments, 5);
  assert.equal(pull.reviews, undefined);
  const reviews = await read('pull&number=1&counts=reviews', [
    '/pulls/1/reviews?per_page=100&page=1',
  ]);
  assert.equal(reviews.reviews, 0);
  assert.equal(reviews.comments, undefined);
  assert.equal(
    (await read('issue&number=2&counts=comments', ['/issues/2'])).comments,
    0,
  );
  const linked = [];
  for (const number of [3, 4]) {
    linked.push(
      await read(`pull&number=${number}&counts=shas`, [
        `/pulls/${number}`,
        `/pulls/${number}/commits?per_page=100&page=1`,
      ]),
    );
  }
  const partial = summarizeActivity(undefined, linked);
  assert.equal(partial.commits, 3);
  assert.equal(partial.partialCommits, true);
  linked[1].shas.push('d');
  const complete = summarizeActivity(undefined, linked);
  assert.equal(complete.commits, 4);
  assert.equal(complete.partialCommits, false);
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
  const rows = [
    { ...release, tag_name: 'draft', draft: true },
    { ...release, tag_name: 'unpublished', published_at: null },
    {
      ...release,
      tag_name: 'v2-beta',
      prerelease: true,
      published_at: '2026-11-23T02:00:00Z',
    },
    release,
  ];
  const paths: string[] = [];
  const names = ['v1', 'tag-only'];
  context.mock.method(globalThis, 'fetch', async (input: string) => {
    const path = new URL(input).pathname;
    paths.push(path);
    if (path === '/graphql')
      return Response.json({
        data: {
          repository: {
            refs: {
              nodes: names.map((name) => ({
                name,
                target: { oid: 'abc', committedDate: release.published_at },
              })),
            },
            releases: {
              pageInfo: { hasNextPage: false },
              // v1 was created after v2-beta, but v2-beta was published later.
              nodes: rows.toReversed().map((row) => ({
                tagName: row.tag_name,
                url: row.html_url,
                isDraft: row.draft,
                isPrerelease: row.prerelease,
                publishedAt: row.published_at,
                tagCommit: row.tag_name === 'v1' ? { oid: 'abc' } : null,
              })),
            },
          },
        },
      });
    if (path.endsWith('/actions/runs')) return Response.json({ workflow_runs });
    if (path.endsWith('/commits'))
      return Response.json([
        { sha: 'abc', commit: { committer: { date: release.published_at } } },
      ]);
    if (path.endsWith('/tags'))
      return Response.json(
        names.map((name) => ({ name, commit: { sha: 'abc' } })),
      );
    if (path.endsWith('/releases')) return Response.json(rows);
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
  assert.equal(paths.filter((path) => path.endsWith('/releases')).length, 1);
  paths.length = 0;
  const authenticated = await githubResponse(
    new URL('https://agentopia.test/api/github?repo=example/release-history'),
    'GET',
    'Bearer checked_token',
  );
  assert.equal(authenticated.status, 200);
  const report = JSON.parse(authenticated.body);
  assert.deepEqual(report.releases, JSON.parse(response.body).releases);
  assert.deepEqual(report.tags, JSON.parse(response.body).tags);
  assert.deepEqual(report.warnings, []);
  assert.equal(paths.filter((path) => path === '/graphql').length, 1);
  assert.equal(paths.filter((path) => path.endsWith('/releases')).length, 0);
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
            releases: { nodes: [], pageInfo: { hasNextPage: false } },
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
  assert.equal(paths.filter((path) => path.endsWith('/tags')).length, 0);
  paths.length = 0;
  url.searchParams.set('refresh', '1');
  const refreshed = await load();
  assert.deepEqual(refreshed.tags, initial.tags);
  assert.equal(paths.filter((path) => path === '/graphql').length, 1);
  assert.equal(paths.filter((path) => path.endsWith('/releases')).length, 0);
});

test('authenticated history falls back to the REST window when creation order truncates releases', async (context) => {
  const slug = 'example/late-publication';
  const url = `https://github.com/${slug}/releases/tag/late`;
  const publishedAt = '2026-11-25T00:00:00Z';
  let rest = 0;
  context.mock.method(globalThis, 'fetch', async (input: string) => {
    const path = new URL(input).pathname;
    if (path === '/graphql')
      return Response.json({
        data: {
          repository: {
            refs: { nodes: [] },
            releases: {
              nodes: Array.from({ length: 30 }, (_, i) => ({
                tagName: `draft-${i}`,
                url: `${url}-${i}`,
                isDraft: true,
                isPrerelease: false,
                publishedAt: null,
                tagCommit: null,
              })),
              pageInfo: { hasNextPage: true },
            },
          },
        },
      });
    if (path.endsWith('/releases')) {
      rest++;
      assert.equal(new URL(input).searchParams.get('per_page'), '30');
      return Response.json([
        {
          tag_name: 'late',
          html_url: url,
          draft: false,
          prerelease: false,
          created_at: '2025-01-01T00:00:00Z',
          published_at: publishedAt,
        },
      ]);
    }
    if (path.endsWith('/actions/runs'))
      return Response.json({ workflow_runs: [] });
    return Response.json([]);
  });
  const report = await getReport({ slug, name: slug }, 'fixture-token');
  assert.deepEqual(report.warnings, []);
  assert.deepEqual(report.releases, [
    {
      title: 'late',
      url,
      status: '릴리스',
      sha: undefined,
      at: publishedAt,
      stage: 'complete',
    },
  ]);
  assert.equal(rest, 1);
});

for (const failure of [
  'refs',
  'releases',
  'recovered',
  'permission',
] as const) {
  test(`authenticated history retains available rows after ${failure} failure`, async (context) => {
    const slug = `example/history-${failure}`;
    const url = `https://github.com/${slug}/releases/tag/v1`;
    const at = '2026-11-22T02:00:00Z';
    let rest = 0;
    context.mock.method(globalThis, 'fetch', async (input: string) => {
      const path = new URL(input).pathname;
      if (path === '/graphql') {
        if (failure === 'permission')
          return new Response(null, { status: 403 });
        return Response.json({
          errors: [
            {
              path: [
                'repository',
                failure === 'recovered' ? 'releases' : failure,
                'nodes',
                1,
              ],
            },
          ],
          data: {
            repository: {
              refs: {
                nodes: [
                  {
                    name: 'tag-only',
                    target: { oid: 'tag', committedDate: at },
                  },
                  ...(failure === 'refs' ? [null] : []),
                ],
              },
              releases: {
                nodes: [
                  {
                    tagName: 'v1',
                    url,
                    isDraft: false,
                    isPrerelease: false,
                    publishedAt: at,
                    tagCommit: { oid: 'released' },
                  },
                  ...(failure === 'releases' || failure === 'recovered'
                    ? [null]
                    : []),
                ],
                pageInfo: { hasNextPage: false },
              },
            },
          },
        });
      }
      if (path.endsWith('/releases')) {
        rest++;
        if (failure === 'releases') return new Response(null, { status: 403 });
        return Response.json([
          { tag_name: 'v1', html_url: url, published_at: at, draft: false },
        ]);
      }
      if (path.endsWith('/actions/runs'))
        return Response.json({ workflow_runs: [] });
      return Response.json([]);
    });
    const report = await getReport({ slug, name: slug }, 'fixture-token');
    assert.deepEqual(
      report.warnings,
      failure === 'recovered'
        ? []
        : [failure === 'releases' ? '릴리스' : '태그'],
    );
    assert.deepEqual(
      report.tags,
      failure === 'permission' ? [] : [{ name: 'tag-only', committedAt: at }],
    );
    assert.deepEqual(report.releases, [
      {
        title: 'v1',
        url,
        at,
        status: '릴리스',
        stage: 'complete',
        sha: failure === 'permission' ? undefined : 'released',
      },
    ]);
    assert.equal(rest, failure === 'refs' ? 0 : 1);
  });
}

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

for (const mode of ['public', 'authenticated'] as const) {
  test(`${mode}: work lookups run while tags are held`, async (context) => {
    const slug = `example/overlap-${mode}`;
    const repo = `https://github.com/${slug}`;
    const mergedAt = '2026-11-01T00:00:00Z';
    const publishedAt = '2026-11-02T00:00:00Z';
    const releaseUrl = `${repo}/releases/tag/v1`;
    const paths: string[] = [];
    let releaseTags!: () => void;
    const tagGate = new Promise<void>((resolve) => {
      releaseTags = resolve;
    });
    const parent = {
      number: 1,
      title: 'Parent issue',
      body: '',
      state: 'closed',
      state_reason: 'completed',
      html_url: `${repo}/issues/1`,
      updated_at: mergedAt,
      closed_at: mergedAt,
      comments: 1,
      labels: [],
      sub_issues_summary: { total: 1, completed: 0 },
    };
    const child = {
      number: 2,
      title: 'Open child issue',
      body: '',
      state: 'open',
      html_url: `${repo}/issues/2`,
      updated_at: mergedAt,
      comments: 0,
      labels: [],
    };
    context.mock.method(
      globalThis,
      'fetch',
      async (input: string, options: RequestInit) => {
        const path = new URL(input).pathname.replace(`/repos/${slug}`, '');
        if (path === '/graphql') {
          if (String(options.body).includes('refs/tags/')) {
            paths.push('GraphQL tags');
            await tagGate;
            return Response.json({
              data: {
                repository: {
                  refs: {
                    nodes: [
                      {
                        name: 'tag-only',
                        target: { oid: 'tag-commit', committedDate: mergedAt },
                      },
                    ],
                  },
                  releases: {
                    nodes: [
                      {
                        tagName: 'v1',
                        url: releaseUrl,
                        publishedAt,
                        isDraft: false,
                        isPrerelease: false,
                        tagCommit: { oid: 'merged' },
                      },
                    ],
                    pageInfo: { hasNextPage: false },
                  },
                },
              },
            });
          }
          paths.push('GraphQL links');
          return Response.json({
            data: { repository: { pullRequests: { nodes: [] } } },
          });
        }
        paths.push(path);
        switch (path) {
          case '/tags':
            await tagGate;
            return Response.json([{ name: 'v1', commit: { sha: 'merged' } }]);
          case '/releases':
            return Response.json([
              {
                tag_name: 'v1',
                html_url: releaseUrl,
                published_at: publishedAt,
                draft: false,
                prerelease: false,
              },
            ]);
          case '/commits':
            return Response.json([
              { sha: 'merged', commit: { committer: { date: mergedAt } } },
            ]);
          case '/issues':
            return Response.json([parent]);
          case '/issues/1/sub_issues':
            return Response.json([child]);
          case '/issues/comments':
            return Response.json([]);
          case '/actions/runs':
            return Response.json({ workflow_runs: [] });
          case '/pulls':
            return Response.json([
              {
                number: 3,
                title: 'Merged change',
                body: 'Closes #1',
                html_url: `${repo}/pull/3`,
                state: 'closed',
                head: { sha: 'head', ref: 'topic' },
                merged_at: mergedAt,
                updated_at: mergedAt,
                merge_commit_sha: 'merged',
              },
            ]);
          case '/pulls/3/commits':
            return Response.json([{ sha: 'head' }]);
          default:
            assert.fail(`Unexpected GitHub request: ${input}`);
        }
      },
    );

    const token = mode === 'authenticated' ? 'fixture-token' : undefined;
    const pending = getReport({ slug, name: slug }, token);
    // Drain the fixed-response work without measuring elapsed time. The gate
    // stays closed even if a regression prevents any follow-up from starting.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const beforeTags = [...paths];
    releaseTags();
    const report = await pending;

    const expectedBeforeTags = [
      '/actions/runs',
      '/issues',
      '/issues/1/sub_issues',
      '/issues/comments',
      '/pulls',
      ...(token
        ? ['GraphQL tags', 'GraphQL links']
        : ['/releases', '/tags', '/pulls/3/commits']),
    ];
    assert.deepEqual(beforeTags.sort(), expectedBeforeTags.toSorted());
    assert.deepEqual(
      paths.sort(),
      [...expectedBeforeTags, ...(token ? [] : ['/commits'])].sort(),
    );
    assert.deepEqual(report.warnings, []);
    assert.deepEqual(report.tags, [
      { name: token ? 'tag-only' : 'v1', committedAt: mergedAt },
    ]);
    assert.equal(report.releases[0]?.sha, 'merged');
    const quest = report.quests.find(({ number }) => number === 1);
    assert.equal(quest?.state, 'closed');
    assert.equal(quest?.pulls[0]?.mergeSha, 'merged');
    assert.equal(quest?.evidence?.url, releaseUrl);
    assert.equal(
      report.quests.find(({ number }) => number === 2)?.state,
      'open',
    );
  });
}
