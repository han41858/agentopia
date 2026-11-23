import type { Locator } from '@playwright/test';
import { alpha, noPlaza } from './fixtures.ts';
import { openWorld } from './github.ts';
import { expect, test } from './test.ts';

type Box = { x: number; y: number; width: number; height: number };

function boxes(locator: Locator) {
  return locator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
}

function overlaps(a: Box, b: Box) {
  // 테두리가 맞닿는 정도(1px)는 겹침으로 보지 않습니다.
  return (
    a.x + a.width - 1 > b.x &&
    b.x + b.width - 1 > a.x &&
    a.y + a.height - 1 > b.y &&
    b.y + b.height - 1 > a.y
  );
}

function overlappingPairs(items: Box[]) {
  const pairs: [number, number][] = [];
  items.forEach((a, i) => {
    items.slice(i + 1).forEach((b, offset) => {
      if (overlaps(a, b)) pairs.push([i, i + 1 + offset]);
    });
  });
  return pairs;
}

for (const width of [1280, 390, 320]) {
  test.describe(`화면 폭 ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('요소가 화면 밖으로 나가거나 서로 겹치지 않는다', async ({ page }) => {
      await openWorld(page, [alpha, noPlaza]);
      await expect(page.locator('.heritage-slot')).toHaveCount(3);

      // 가로 스크롤이 생기지 않습니다.
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      const controls = await boxes(page.locator('.world-controls button'));
      const palaces = await boxes(page.locator('.kingdom'));
      const facilities = await boxes(page.locator('.facility-marker'));
      const monsters = await boxes(page.locator('.monster-marker'));
      const heritage = await boxes(page.locator('.heritage-slot'));
      expect(facilities).toHaveLength(4);
      expect(monsters).toHaveLength(5);

      for (const box of [
        ...controls,
        ...palaces,
        ...facilities,
        ...monsters,
        ...heritage,
      ]) {
        expect(box.width).toBeGreaterThan(0);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }

      expect(overlappingPairs(controls)).toEqual([]);
      expect(overlappingPairs(facilities)).toEqual([]);
      expect(overlappingPairs(monsters)).toEqual([]);
      expect(overlappingPairs([...palaces, ...heritage])).toEqual([]);
      expect(overlappingPairs([...palaces, ...facilities])).toEqual([]);

      // 시설은 자기 왕국의 성벽 안에 있습니다.
      for (const kingdom of await page.locator('.kingdom-area').all()) {
        const [area] = await boxes(kingdom);
        for (const box of await boxes(kingdom.locator('.facility-marker'))) {
          expect(box.x).toBeGreaterThanOrEqual(area.x);
          expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width);
          expect(box.y).toBeGreaterThanOrEqual(area.y);
          expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height);
        }
      }
    });

    test('상세 창이 화면 안에 들어온다', async ({ page }) => {
      await openWorld(page, [alpha]);
      await page.getByRole('button', { name: /PR #11/ }).click();
      const [dialog] = await boxes(
        page.getByRole('dialog', { name: 'PR #11' }),
      );

      expect(dialog.x).toBeGreaterThanOrEqual(0);
      expect(dialog.x + dialog.width).toBeLessThanOrEqual(width);
      await expect(
        page.getByRole('dialog').getByRole('button', { name: '닫기' }),
      ).toBeInViewport();
    });
  });
}
