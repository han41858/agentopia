import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBranchRoads } from './branch-roads.ts';
import { githubResponse } from './github.ts';

test('maps confirmed PR targets, keeps unmerged and merged routes separate from facilities, and removes deleted branches', () => {
  const pulls = [
    { number: 1, head: 'feature', base: 'dev', merged: false },
    { number: 2, head: 'child', base: 'feature', merged: false },
    { number: 3, head: 'shipped', base: 'release', merged: true },
    { number: 4, head: 'deleted', base: 'release', merged: true },
  ];
  const inventory = {
    defaultBranch: 'release',
    names: ['child', 'dev', 'feature', 'main', 'shipped'],
    partial: false,
  };
  const roads = buildBranchRoads(inventory, pulls);
  assert.equal(roads[0].name, 'release');
  assert.equal(roads[0].role, 'palace');
  assert.equal(roads[1].role, 'plaza');
  assert.equal(roads.find(({ name }) => name === 'main')?.parent, undefined);
  assert.equal(roads.find(({ name }) => name === 'child')?.parent, 'feature');
  assert.equal(roads.find(({ name }) => name === 'shipped')?.parent, 'release');
  assert.equal(
    roads.some(({ name }) => name === 'deleted'),
    false,
  );
  assert.equal(buildBranchRoads(inventory, [])[1].role, 'road');
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
    names: ['feature'],
    partial: true,
  });
  assert.deepEqual(second.branchPulls, [
    { number: 1, base: 'trunk', head: 'feature', merged: false },
  ]);
  assert.equal(fetch.mock.callCount(), count + 2);
  await githubResponse(url, 'GET');
  assert.equal(fetch.mock.callCount(), count + 2);
});
