import assert from 'node:assert/strict';
import { test } from 'node:test';
import { branchCenters, buildBranchRoads } from './branch-roads.ts';
import { readBranches } from './github-report.ts';
import { githubResponse } from './github.ts';
import { repositoryRegion } from './model.ts';

test('maps confirmed PR targets, keeps unmerged and merged routes separate from facilities, and removes deleted branches', () => {
  const pulls = [
    { number: 1, head: 'feature', base: 'dev', merged: false },
    { number: 2, head: 'child', base: 'feature', merged: false },
    { number: 3, head: 'shipped', base: 'release', merged: true },
    { number: 4, head: 'deleted', base: 'release', merged: true },
  ];
  const inventory = {
    defaultBranch: 'release',
    names: ['child', 'dev', 'feature', 'legacy', 'shipped'],
    partial: false,
  };
  const roads = buildBranchRoads(inventory, pulls);
  assert.equal(roads[0].name, 'release');
  assert.equal(roads[0].role, 'palace');
  assert.equal(roads.some(({ role }) => role === 'plaza'), false);
  assert.equal(roads.find(({ name }) => name === 'feature')?.parent, 'dev');
  assert.equal(roads.find(({ name }) => name === 'legacy')?.parent, undefined);
  assert.equal(roads.find(({ name }) => name === 'child')?.parent, 'feature');
  assert.equal(roads.find(({ name }) => name === 'shipped')?.parent, 'release');
  assert.equal(
    roads.some(({ name }) => name === 'deleted'),
    false,
  );
});

test('ambiguous and cyclic PR targets do not invent a parent', () => {
  const roads = buildBranchRoads(
    {
      defaultBranch: 'dev',
      names: ['dev', 'main', 'cycle-a', 'cycle-b', 'ambiguous'],
      partial: true,
    },
    [
      { head: 'cycle-a', base: 'cycle-b', number: 1, merged: false },
      { head: 'cycle-b', base: 'cycle-a', number: 2, merged: false },
      { head: 'ambiguous', base: 'main', number: 3, merged: false },
      { head: 'ambiguous', base: 'dev', number: 4, merged: false },
      { head: 'beyond-page', base: 'dev', number: 5, merged: false },
    ],
  );
  assert.equal(roads[0].role, 'palace');
  assert.equal(roads.find(({ name }) => name === 'beyond-page')?.parent, 'dev');
  for (const name of ['cycle-a', 'cycle-b', 'ambiguous'])
    assert.equal(roads.find((road) => road.name === name)?.parent, undefined);
});

test('uses optional bounded inventory and only local GitHub PR refs', async (context) => {
  context.mock.method(console, 'debug', () => {});
  const fixture = (number: number, repository: string) => ({
    number,
    state: 'open',
    title: 'Work',
    html_url: 'https://github.com/example/roads/pull/' + number,
    draft: false,
    body: '',
    head: { ref: 'feature', sha: 'abc', repo: { full_name: repository } },
    base: { ref: 'trunk', repo: { full_name: 'Example/Roads' } },
    updated_at: '',
  });
  const fetch = context.mock.method(
    globalThis,
    'fetch',
    async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/actions/runs'))
        return Response.json({ workflow_runs: [] });
      if (url.pathname.endsWith('/pulls'))
        return Response.json([
          fixture(1, 'example/roads'),
          fixture(2, 'fork/roads'),
        ]);
      if (url.pathname.endsWith('/commits')) return Response.json([]);
      if (url.pathname.endsWith('/branches')) {
        assert.equal(url.searchParams.get('per_page'), '100');
        return Response.json([{ name: 'feature' }], {
          headers: {
            link: '<https://api.github.com/example?page=2>; rel="next"',
          },
        });
      }
      if (url.pathname.endsWith('/branches/main'))
        return Response.json({ message: 'Not Found' }, { status: 404 });
      if (url.pathname.endsWith('/branches/master'))
        return Response.json({ name: 'master' });
      if (url.pathname === '/repos/example/roads')
        return Response.json({ default_branch: 'trunk' });
      return Response.json([]);
    },
  );
  const url = new URL('https://agentopia.test/api/github?repo=example/roads');
  const first = JSON.parse((await githubResponse(url, 'GET')).body);
  assert.equal(first.branchInventory, undefined);
  const count = fetch.mock.callCount();
  url.searchParams.set('branches', '1');
  const second = JSON.parse((await githubResponse(url, 'GET')).body);
  assert.deepEqual(second.branchInventory, {
    defaultBranch: 'trunk',
    names: ['feature', 'master'],
    partial: true,
  });
  assert.deepEqual(second.branchPulls, [
    { number: 1, base: 'trunk', head: 'feature', merged: false },
  ]);
  assert.equal(fetch.mock.callCount(), count + 4);
  await githubResponse(url, 'GET');
  assert.equal(fetch.mock.callCount(), count + 4);
});

test('chooses main, master, then the GitHub default, with a plaza only for a separate default', () => {
  const cases = [
    { defaultBranch: 'dev', names: ['main'], palace: 'main', plaza: 'dev' },
    {
      defaultBranch: 'develop',
      names: ['master'],
      palace: 'master',
      plaza: 'develop',
    },
    { defaultBranch: 'main', names: ['dev', 'master'], palace: 'main' },
    { defaultBranch: 'master', names: ['develop'], palace: 'master' },
    { defaultBranch: 'trunk', names: ['dev', 'develop'], palace: 'trunk' },
    {
      defaultBranch: 'dev',
      names: ['master', 'main'],
      palace: 'main',
      plaza: 'dev',
    },
  ];
  for (const { defaultBranch, names, palace, plaza } of cases) {
    const inventory = { defaultBranch, names, partial: false };
    assert.deepEqual(branchCenters(inventory), {
      palace,
      plaza,
      bridge: plaza !== undefined,
    });
    const roads = buildBranchRoads(inventory, []);
    assert.equal(roads[0].name, palace);
    assert.equal(roads.find(({ role }) => role === 'plaza')?.name, plaza);
  }
});

test('only probes missing higher-priority candidates in a partial list', async (context) => {
  context.mock.method(console, 'debug', () => {});
  const paths: string[] = [];
  context.mock.method(globalThis, 'fetch', async (input: string) => {
    const path = new URL(input).pathname;
    paths.push(path);
    if (path.endsWith('/branches/main')) return Response.json({ name: 'main' });
    if (path.endsWith('/branches')) {
      return Response.json([{ name: 'master' }], {
        headers: path.endsWith('/complete/branches')
          ? undefined
          : { link: '<https://api.github.com/next>; rel="next"' },
      });
    }
    return Response.json({
      default_branch: path.endsWith('/default-main') ? 'main' : 'dev',
    });
  });
  const cases = [
    { name: 'hidden-main', palace: 'main', probes: ['/branches/main'] },
    { name: 'default-main', palace: 'main', probes: [] },
    { name: 'complete', palace: 'master', probes: [] },
  ];
  for (const { name, palace, probes } of cases) {
    const slug = `example/${name}`;
    const root = `/repos/${slug}`;
    const result = await readBranches(repositoryRegion(slug));
    assert.equal(branchCenters(result).palace, palace);
    assert.deepEqual(
      paths.splice(0).filter((path) => path.startsWith(`${root}/branches/`)),
      probes.map((path) => root + path),
    );
  }
});

for (const renamed of ['main', 'master']) {
  test(`a renamed ${renamed} does not discard a partial branch inventory`, async (context) => {
    context.mock.method(console, 'debug', () => {});
    const slug = `example/renamed-${renamed}`;
    const root = `/repos/${slug}`;
    const probes: string[] = [];
    const fetch = context.mock.method(
      globalThis,
      'fetch',
      async (input: string, options: RequestInit) => {
        const { pathname } = new URL(input);
        if (pathname === root) return Response.json({ default_branch: 'trunk' });
        if (pathname === `${root}/branches`)
          return Response.json([{ name: 'feature' }], {
            headers: { link: '<https://api.github.com/next>; rel="next"' },
          });
        const name = pathname.slice(`${root}/branches/`.length);
        assert.ok(name === 'main' || name === 'master');
        assert.equal(options.redirect, 'manual');
        probes.push(name);
        if (name === renamed)
          return new Response(null, {
            status: 301,
            headers: { location: `https://api.github.com${root}/branches/trunk` },
          });
        if (name === 'main') return new Response(null, { status: 404 });
        return Response.json({ name: 'master' });
      },
    );

    const region = repositoryRegion(slug);
    const result = await readBranches(region);
    const hasMaster = renamed === 'main';
    assert.deepEqual(result, {
      defaultBranch: 'trunk',
      names: hasMaster ? ['feature', 'master'] : ['feature'],
      partial: true,
    });
    assert.deepEqual(branchCenters(result), {
      palace: hasMaster ? 'master' : 'trunk',
      plaza: hasMaster ? 'trunk' : undefined,
      bridge: hasMaster,
    });
    assert.deepEqual(probes, ['main', 'master']);
    assert.deepEqual(await readBranches(region), result);
    assert.equal(fetch.mock.callCount(), 4);
  });
}
