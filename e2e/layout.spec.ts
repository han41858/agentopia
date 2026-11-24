import type { Locator, Page } from '@playwright/test';
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

/**
 * 성벽 안쪽 도형(위가 둥근 아치) 밖으로 모서리가 나간 요소의 이름을 돌려줍니다.
 * 화면 좌표를 성벽 SVG 좌표로 바꿔 판정하므로 지도 축소 배율과 무관합니다.
 */
function outsideWall(page: Page, selector: string) {
  return page.locator('.kingdom-area').evaluateAll((areas, selector) => {
    const outside: string[] = [];
    for (const area of areas) {
      const wall = area.querySelector<SVGSVGElement>('.kingdom-wall');
      const shape = wall?.querySelector<SVGPathElement>('defs path');
      const matrix = wall?.getScreenCTM()?.inverse();
      if (!shape || !matrix) throw new Error('성벽 도형을 찾지 못했습니다.');
      for (const node of area.querySelectorAll(selector)) {
        const box = node.getBoundingClientRect();
        const corners = [
          [box.left, box.top],
          [box.right, box.top],
          [box.left, box.bottom],
          [box.right, box.bottom],
        ];
        const inside = corners.every(([x, y]) =>
          shape.isPointInFill(new DOMPoint(x, y).matrixTransform(matrix)),
        );
        if (!inside)
          outside.push(node.getAttribute('aria-label') ?? node.className);
      }
    }
    return outside;
  }, selector);
}

// 터치 화면에서 누르는 요소의 최소 크기(src/styles.css의 --map-hit-size).
const touchTarget = 44;

for (const width of [1280, 390, 320]) {
  // 좁은 화면은 터치 기기로 실행해 `pointer: coarse` 전용 스타일까지 확인합니다.
  const touch = width < 640;

  test.describe(`화면 폭 ${width}px${touch ? ' · 터치' : ''}`, () => {
    // 성벽은 크기가 바뀔 때 잠깐 늘어나는 동작이 있어, 위치를 재는 테스트는
    // 동작 줄이기 설정으로 최종 배치만 봅니다.
    test.use({
      viewport: { width, height: 800 },
      hasTouch: touch,
      reducedMotion: 'reduce',
    });

    test.beforeEach(async ({ page }) => {
      await openWorld(page, [alpha, noPlaza]);
      await expect(page.locator('.heritage-slot')).toHaveCount(3);
      expect(
        await page.evaluate(() => matchMedia('(pointer: coarse)').matches),
      ).toBe(touch);
    });

    test('요소가 화면 밖으로 나가거나 서로 겹치지 않는다', async ({ page }) => {
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
    });

    test('시설, 유산, 도로 노드가 둥근 성벽 안에 있다', async ({ page }) => {
      await expect
        .poll(() => outsideWall(page, '.facility-marker'))
        .toEqual([]);
      await expect.poll(() => outsideWall(page, '.heritage-slot')).toEqual([]);
      await expect
        .poll(() => outsideWall(page, '.branch-road-node'))
        .toEqual([]);
      // 판정이 실제로 아치를 따르는지: 사각 경계 안이지만 아치 밖인 왼쪽 위
      // 모서리 근처는 밖으로 나옵니다.
      const corner = await page
        .locator('.kingdom-area')
        .first()
        .evaluate((area) => {
          const wall = area.querySelector<SVGSVGElement>('.kingdom-wall');
          const shape = wall?.querySelector<SVGPathElement>('defs path');
          const matrix = wall?.getScreenCTM()?.inverse();
          const box = area.getBoundingClientRect();
          const point = new DOMPoint(box.left + 12, box.top + 12);
          return shape?.isPointInFill(point.matrixTransform(matrix));
        });
      expect(corner).toBe(false);
    });

    test('상세 창이 화면 안에 들어온다', async ({ page }) => {
      const facility = page.getByRole('button', { name: /PR #11/ });
      if (touch) await facility.tap();
      else await facility.click();
      const dialog = page.getByRole('dialog', { name: 'PR #11' });
      const [box] = await boxes(dialog);

      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await expect(
        dialog.getByRole('button', { name: '닫기' }),
      ).toBeInViewport();
    });

    test('두 모드에서 왕궁 로고와 앱 이름이 한 줄에 보인다', async ({
      page,
    }) => {
      const crest = page.locator('.world-heading .crest');
      const brand = page.getByRole('heading', {
        name: 'Agentopia',
        exact: true,
      });
      const buttons = page.locator('.world-controls > button, .refresh-button');
      for (const mode of ['world', 'simple']) {
        if (mode === 'simple') {
          const modeSwitch = page.locator('.mode-switch');
          if (touch) await modeSwitch.tap();
          else await modeSwitch.click();
        }
        await expect(page.locator('[data-display-mode]')).toHaveAttribute(
          'data-display-mode',
          mode,
        );
        await expect(crest).toBeInViewport({ ratio: 1 });
        await expect(brand).toBeInViewport({ ratio: 1 });
        const [logo] = await boxes(crest);
        const [title] = await boxes(brand);
        expect(title.x).toBeGreaterThanOrEqual(logo.x + logo.width);
        const logoCenter = logo.y + logo.height / 2;
        expect(title.y + title.height / 2).toBeCloseTo(logoCenter, 0);

        const controls = await boxes(buttons);
        expect(controls).toHaveLength(4);
        expect(overlappingPairs([logo, title, ...controls])).toEqual([]);
        const [first] = controls;
        for (const button of controls) {
          expect(button.y + button.height / 2).toBeCloseTo(
            first.y + first.height / 2,
            0,
          );
          expect(button.height).toBe(first.height);
          expect(button.x).toBeGreaterThanOrEqual(0);
          expect(button.x + button.width).toBeLessThanOrEqual(width);
        }
        if (width === 320) {
          expect(first.y).toBeGreaterThanOrEqual(logo.y + logo.height);
        } else if (!touch) {
          expect(first.x).toBeGreaterThanOrEqual(title.x + title.width);
          expect(first.y + first.height / 2).toBeCloseTo(logoCenter, 0);
        }
      }
    });

    if (touch) {
      test('두 모드에서 이슈 링크와 활동 펼침 및 닫기를 터치할 수 있다', async ({
        page,
      }) => {
        for (const mode of ['world', 'simple']) {
          if (mode === 'simple') await page.locator('.mode-switch').tap();
          await expect(page.locator('[data-display-mode]')).toHaveAttribute(
            'data-display-mode',
            mode,
          );
          await page.getByRole('button', { name: /^이슈 #1 / }).tap();
          const dialog = page.getByRole('dialog', { name: '이슈 #1' });
          const title = dialog.getByRole('link', {
            name: '이슈 #1',
            exact: true,
          });
          await expect(title).toBeInViewport();
          await expect(title).toHaveAttribute('href', /issues\/1$/);
          await expect(title).toHaveAttribute('target', '_blank');

          const commits = dialog.getByRole('button', { name: '고유 커밋 3개' });
          const commit = dialog.getByRole('link', { name: 'a1b2c3d' });
          const close = dialog.getByRole('button', { name: '닫기' });
          await commits.tap();
          await expect(commits).toHaveAttribute('aria-expanded', 'true');
          await expect(commit).toBeVisible();
          await expect(close).toBeInViewport();
          await commits.tap();
          await expect(commits).toHaveAttribute('aria-expanded', 'false');
          await expect(commit).toBeHidden();
          await close.tap();
          await expect(dialog).toBeHidden();
        }
      });

      test('터치로 누르는 요소가 충분히 크다', async ({ page }) => {
        const targets = [
          ...(await boxes(
            page.locator('.world-controls > button, .refresh-button'),
          )),
          ...(await boxes(page.locator('.facility-marker'))),
          ...(await boxes(page.locator('.heritage-slot'))),
          ...(await boxes(
            page.locator('.branch-road-node[data-road-role="road"]'),
          )),
        ];
        expect(targets).toHaveLength(4 + 4 + 3 + 4);
        for (const box of targets) {
          expect(Math.round(box.width)).toBeGreaterThanOrEqual(touchTarget);
          expect(Math.round(box.height)).toBeGreaterThanOrEqual(touchTarget);
        }

        await page.getByRole('button', { name: /PR #11/ }).tap();
        const counters = await boxes(
          page.getByRole('dialog').locator('.activity-counter'),
        );
        expect(counters).toHaveLength(3);
        for (const box of counters) {
          expect(Math.round(box.width)).toBeGreaterThanOrEqual(touchTarget);
          expect(Math.round(box.height)).toBeGreaterThanOrEqual(touchTarget);
        }
      });
    } else {
      test('마우스 화면에서는 터치용 확대가 적용되지 않는다', async ({
        page,
      }) => {
        const [option] = await boxes(page.locator('.mode-switch-option'));
        expect(option.height).toBeLessThan(touchTarget);
      });
    }
  });
}
