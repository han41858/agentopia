import assert from 'node:assert/strict';
import { test } from 'node:test';
import { measureRoadLayout } from '../src/road-layout.ts';
import { branchCenters, buildBranchRoads } from './branch-roads.ts';

function marker(
  x: number,
  y: number,
  dataset: Record<string, string> = {},
  width = 10,
  height = 10,
) {
  return {
    dataset,
    getBoundingClientRect: () => ({ x, y, width, height }),
    querySelector: () => null,
  };
}

for (const defaultBranch of ['main', 'develop']) {
  test(`keeps PR and guide roads connected with ${defaultBranch} as default`, () => {
    const inventory = {
      defaultBranch,
      names: ['main', 'feature', 'unrelated'],
      partial: false,
    };
    const centers = branchCenters(inventory);
    const roads = buildBranchRoads(inventory, [
      { number: 7, head: 'feature', base: defaultBranch, merged: false },
    ]);
    const palaceRoad = roads.find(({ role }) => role === 'palace');
    const visible = roads.filter(({ role }) => role !== 'palace');
    const palaceMarker = marker(45, 10);
    const plazaArt = centers.plaza ? marker(45, 35) : null;
    const area = {
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 200 }),
      querySelector: (selector: string) => {
        if (selector === '[data-road-palace]') return palaceMarker;
        if (selector === '[data-road-role="plaza"] img') return plazaArt;
        return null;
      },
      querySelectorAll: (selector: string) => {
        if (selector === '[data-road-node]')
          return [
            marker(15, 65, { roadNode: 'feature' }),
            marker(75, 65, { roadNode: 'unrelated' }),
          ];
        if (selector === '[data-road-pr]')
          return [marker(15, 95, { roadPr: '7' })];
        return [];
      },
    } as unknown as HTMLElement;
    const { paths } = measureRoadLayout(area, {
      ...centers,
      palaceRoad,
      visible,
      roads,
    });
    const origin = centers.plaza ? 'M50 40 ' : 'M50 20 ';
    const branchPath = paths.find(({ key }) => key === 'feature');
    const guidePath = paths.find(({ key }) => key === 'unrelated');
    assert.ok(branchPath);
    assert.ok(branchPath.d.startsWith(origin));
    assert.equal(branchPath.guide, undefined);
    assert.ok(guidePath);
    assert.ok(guidePath.d.startsWith(origin));
    assert.equal(guidePath.guide, true);
    assert.equal(
      roads.find(({ name }) => name === 'unrelated')?.parent,
      undefined,
    );
    const facilityPath = paths.find(({ pull }) => pull === 7);
    assert.equal(facilityPath?.from, 'feature');
    assert.equal(facilityPath?.d, 'M20 75 C20 85 20 85 20 95');
  });
}
