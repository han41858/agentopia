import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { githubResponse } = await import(
  pathToFileURL(process.cwd() + '/server/github.ts')
);
const current = process.argv[2] === 'after';
const slug = 'example/large',
  web = 'https://github.com/' + slug;
process.env.AGENTOPIA_REFRESH_CACHE_KEY =
  'fixture-only-long-enough-for-signatures';
const stamp = '2026-11-25T00:00:00Z';
const issues = Array.from({ length: 50 }, (_, i) => ({
  number: i + 1,
  title: 'Issue ' + i,
  state: 'open',
  body: '',
  html_url: web + '/issues/' + (i + 1),
  updated_at: stamp,
  comments: 0,
  labels: [],
}));
const pulls = Array.from({ length: 50 }, (_, i) => ({
  number: i + 101,
  title: 'PR ' + i,
  state: 'open',
  html_url: web + '/pull/' + (i + 101),
  body: '',
  head: { sha: 'head' + i, ref: 'topic' + i },
  updated_at: stamp,
}));
const release = {
  tag_name: 'v1',
  html_url: web + '/releases/tag/v1',
  published_at: stamp,
  draft: false,
  prerelease: false,
};
let calls = 0,
  validated = 0,
  failRuns = false;
globalThis.fetch = async (input, options) => {
  calls++;
  await new Promise((r) => setTimeout(r, 10));
  const path = new URL(input).pathname.replace('/repos/' + slug, '');
  if (path === '/graphql') {
    if (options.body.includes('refs/tags/'))
      return Response.json({
        data: {
          repository: {
            refs: { nodes: [] },
            releases: {
              nodes: [
                {
                  tagName: 'v1',
                  url: release.html_url,
                  publishedAt: stamp,
                  isDraft: false,
                  isPrerelease: false,
                },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        },
      });
    return Response.json({
      data: { repository: { pullRequests: { nodes: [] } } },
    });
  }
  if (failRuns && path === '/actions/runs')
    return Response.json({ message: 'Unavailable' }, { status: 503 });
  if (new Headers(options.headers).get('if-none-match') === '"v1"') {
    validated++;
    return new Response(null, { status: 304 });
  }
  const rows = {
    '/issues': issues,
    '/pulls': pulls,
    '/actions/runs': {
      workflow_runs: [
        {
          id: 700,
          run_attempt: 1,
          name: 'CI',
          display_title: 'CI #101',
          path: '.github/workflows/ci.yml',
          event: 'pull_request',
          html_url: web + '/actions/runs/700',
          status: 'completed',
          conclusion: 'success',
          created_at: stamp,
          updated_at: stamp,
          head_branch: 'topic0',
          head_sha: 'head0',
          pull_requests: [{ number: 101 }],
        },
      ],
    },
    '/issues/comments': [],
    '/tags': [],
    '/releases': [release],
    '/pulls/101': { comments: 0, commits: 0 },
    '/commits': [],
  };
  const data =
    rows[path] ?? (/\/(comments|commits|reviews)$/.test(path) ? [] : undefined);
  assert.notEqual(data, undefined, path);
  return Response.json(data, { headers: { etag: '"v1"' } });
};
let ticket = '';
async function phase(name, params) {
  calls = validated = 0;
  const start = performance.now();
  const report = !params.includes('summary');
  const url = new URL(
    'https://fixture.test/api/github?repo=' + slug + '&' + params,
  );
  const r = await githubResponse(
    url,
    current && report && ticket ? 'POST' : 'GET',
    'Bearer fixture',
    current && report ? ticket : undefined,
  );
  const o = JSON.parse(r.body);
  assert.equal(r.status, 200, r.body);
  ticket = o.refreshTicket ?? ticket;
  if (report) {
    assert.equal(o.quests.length, 50);
    assert.equal(o.forges.length, 50);
    if (!failRuns)
      assert.ok(
        o.forges
          .find((f) => f.number === 101)
          .runs.some((r) => r.url.endsWith('/700')),
      );
    if (name === 'first')
      assert.equal(o.releases[0].title, 'v1', JSON.stringify(o.releases[0]));
    if (failRuns) assert.ok(o.warnings.length);
  } else assert.equal(o.reviews, 0);
  if (current) {
    const requestLimits = {
      first: 6,
      automatic: 4,
      popup: 1,
      manual_partial: 6,
    };
    assert.ok(calls <= requestLimits[name], `${name}: ${calls} requests`);
    if (name === 'automatic') assert.ok(validated >= 3);
  }
  console.log(name, {
    requests: calls,
    notModified: validated,
    elapsedMs: Math.round(performance.now() - start),
  });
}
await phase('first', 'measure=refresh');
await phase('automatic', 'measure=refresh&history=cached');
await phase('popup', 'summary=pull&number=101&counts=reviews');
failRuns = true;
await phase('manual_partial', 'measure=refresh&refresh=1&history=cached');
