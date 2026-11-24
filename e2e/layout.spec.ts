import type { Locator, Page } from '@playwright/test';
import { alpha, alphaReport, noPlaza } from './fixtures.ts';
import { mockGitHub, openWorld, seedSettings } from './github.ts';
import { expect, test } from './test.ts';

type Box = { x: number; y: number; width: number; height: number };

async function mockRefreshUsage(page: Page) {
  // 공통 모의 응답은 유지하고 alpha 갱신 응답에만 사용량을 넣습니다.
  await page.route('**/api/github?**', async (route) => {
    const { searchParams } = new URL(route.request().url());
    const otherQueries = [
      'owner',
      'heritage',
      'summary',
      'activity',
      'repository',
    ];
    if (
      searchParams.get('repo') !== alpha ||
      otherQueries.some((key) => searchParams.has(key))
    ) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      headers: {
        'X-Agentopia-GitHub-Usage': JSON.stringify({
          core: { limit: 60, used: 15, remaining: 45 },
        }),
      },
      json: alphaReport,
    });
  });
}

function boxes(locator: Locator) {
  return locator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
}

async function expectUsageBelowRefresh(page: Page) {
  const [refresh] = await boxes(page.locator('.refresh-button'));
  const [usage] = await boxes(page.locator('.refresh-usage'));
  expect(usage.y).toBeCloseTo(refresh.y + refresh.height, 1);
  expect(usage.x + usage.width).toBeCloseTo(refresh.x + refresh.width, 1);
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

test.describe('높은 데스크톱의 왕국 하나', () => {
  test.use({
    viewport: { width: 1280, height: 1400 },
    reducedMotion: 'reduce',
  });

  test('첫 성벽이 헤더 바로 아래에 놓인다', async ({ page }) => {
    await mockGitHub(page);
    await mockRefreshUsage(page);
    await seedSettings(page, [alpha]);
    await page.goto('/');
    const wall = page.locator('.kingdom-wall');
    const title = page.getByRole('heading', { name: 'Agentopia' });
    const usageValue = page.locator('.github-usage-value');
    await expect(wall).toHaveCount(1);
    await expect(wall).toBeVisible();
    await expect(usageValue).toBeVisible();
    await expect(usageValue).toContainText('25.0%');
    const [heading] = await boxes(title);
    expect(heading.y).toBeLessThanOrEqual(24);

    const [firstWall] = await boxes(wall);
    const headerItems = await boxes(
      page.locator(
        '.crest, .world-controls > button:visible, .github-usage-value:visible',
      ),
    );
    const headerBottom = Math.max(
      ...headerItems.map((box) => box.y + box.height),
    );
    const gap = firstWall.y - headerBottom;
    expect(gap).toBeGreaterThanOrEqual(12);
    expect(gap).toBeLessThanOrEqual(20);
  });
});

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
      if (touch) {
        await mockGitHub(page);
        await mockRefreshUsage(page);
        await seedSettings(page, [alpha, noPlaza]);
        await page.goto('/');
        // 도구를 펼치지 않고 초기 갱신이 끝날 때까지 기다립니다.
        await expect(page.locator('.refresh-button')).toHaveAttribute(
          'aria-busy',
          'false',
        );
      } else {
        await openWorld(page, [alpha, noPlaza]);
      }
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

      const controls = await boxes(
        page.locator(
          '.header-bookmark:visible, .world-controls button:visible',
        ),
      );
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

    if (touch) {
      test('두 모드에서 이슈 링크와 활동 펼침 및 닫기를 터치할 수 있다', async ({
        page,
      }) => {
        for (const mode of ['world', 'simple']) {
          if (mode === 'simple') {
            await page.getByRole('button', { name: '상단 도구 열기' }).tap();
            await page.locator('.mode-switch').tap();
            await page.getByRole('button', { name: '상단 도구 접기' }).tap();
          }
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

      test('두 모드에서 제목과 지도를 고정하고 같은 줄에 도구를 펼친다', async ({
        page,
      }) => {
        const title = page.getByRole('heading', { name: 'Agentopia' });
        const open = page.getByRole('button', { name: '상단 도구 열기' });
        const close = page.getByRole('button', { name: '상단 도구 접기' });
        const controls = page.locator('.world-controls');
        const map = page.locator('.map-viewport');
        const wall = page.locator('.kingdom-wall').first();
        const usageValue = page.locator('.github-usage-value');
        const bookmarkFace = page.locator('.header-bookmark-face');

        for (const mode of ['world', 'simple']) {
          await expect(page.locator('[data-display-mode]')).toHaveAttribute(
            'data-display-mode',
            mode,
          );
          await expect(open).toHaveAttribute('aria-expanded', 'false');
          await expect(controls).toBeHidden();
          await expect(usageValue).toBeHidden();
          await expect(title).toBeInViewport({ ratio: 1 });
          const [heading] = await boxes(title);
          const [crest] = await boxes(page.locator('.crest'));
          const [collapsedHit] = await boxes(open);
          const [collapsedFace] = await boxes(bookmarkFace);
          const [collapsedIcon] = await boxes(open.locator('svg'));
          const [viewport] = await boxes(map);
          const [firstWall] = await boxes(wall);
          expect(firstWall.y).toBeGreaterThanOrEqual(
            collapsedHit.y + collapsedHit.height,
          );
          const centerY = collapsedHit.y + collapsedHit.height / 2;
          expect(heading.y + heading.height / 2).toBeCloseTo(
            crest.y + crest.height / 2,
            0,
          );
          expect(centerY).toBeCloseTo(crest.y + crest.height / 2, 1);
          expect(heading.x + heading.width).toBeLessThan(collapsedHit.x);
          expect(collapsedHit.x + collapsedHit.width).toBe(width);
          expect(collapsedHit.width).toBe(touchTarget);
          expect(collapsedHit.height).toBe(touchTarget);
          expect(collapsedFace.x + collapsedFace.width).toBe(width);
          expect(collapsedFace.y).toBe(collapsedHit.y);
          expect(collapsedFace.height).toBe(collapsedHit.height);
          expect(collapsedIcon.x + collapsedIcon.width / 2).toBeCloseTo(
            collapsedFace.x + collapsedFace.width / 2,
            1,
          );
          expect(collapsedIcon.y + collapsedIcon.height / 2).toBeCloseTo(
            centerY,
            1,
          );

          // 표시 영역 왼쪽의 투명한 부분을 눌러 도구를 엽니다.
          await page.touchscreen.tap(
            Math.round((collapsedHit.x + collapsedFace.x) / 2),
            Math.round(centerY),
          );
          await expect(close).toHaveAttribute('aria-expanded', 'true');
          const buttons = page.locator(
            '.header-bookmark, .world-controls > button',
          );
          await expect(buttons).toHaveCount(5);
          for (const [index, name] of [
            '상단 도구 접기',
            '새로 고침',
            '간단 모드',
            '저장소 추가',
            'GitHub 연결',
          ].entries()) {
            await expect(buttons.nth(index)).toHaveAccessibleName(name);
          }
          const row = await boxes(buttons);
          const [expandedFace] = await boxes(bookmarkFace);
          const refresh = row[1];
          expect(collapsedFace.width).toBe(refresh.width * 0.75);
          expect(expandedFace.width).toBe(collapsedFace.width);
          expect(expandedFace.height).toBe(collapsedFace.height);
          expect(expandedFace.y).toBe(row[0].y);
          expect(expandedFace.x + expandedFace.width).toBe(
            row[0].x + row[0].width,
          );
          expect(row[0].x).toBeLessThan(collapsedHit.x);
          expect(row[4].x + row[4].width).toBe(width);
          for (const [index, button] of row.entries()) {
            expect(button.x).toBeGreaterThanOrEqual(
              index ? row[index - 1].x + row[index - 1].width : 0,
            );
            expect(button.y + button.height / 2).toBeCloseTo(centerY, 1);
            expect(button.x + button.width).toBeLessThanOrEqual(width);
          }

          const singles = page.locator(
            '.header-bookmark, .world-controls > button:not(.mode-switch)',
          );
          for (const [index, button] of (await boxes(singles)).entries()) {
            expect(button.width).toBe(collapsedHit.width);
            expect(button.height).toBe(collapsedHit.height);
            const single = singles.nth(index);
            const face = index === 0 ? bookmarkFace : single;
            await expect(single).toHaveCSS('padding', '0px');
            await expect(face).toHaveCSS('border-width', '1px');
            const [icon] = await boxes(single.locator('svg'));
            expect(icon.width).toBe(collapsedIcon.width);
            expect(icon.height).toBe(collapsedIcon.height);
            const faceBox = index === 0 ? expandedFace : button;
            expect(icon.x + icon.width / 2).toBeCloseTo(
              faceBox.x + faceBox.width / 2,
              1,
            );
            expect(icon.y + icon.height / 2).toBeCloseTo(centerY, 1);
          }
          await expectUsageBelowRefresh(page);
          await expect(usageValue).toBeVisible();
          await expect(usageValue).toContainText('25.0%');
          const [usage] = await boxes(usageValue);
          const [expandedWall] = await boxes(wall);
          const toolsBottom = Math.max(
            ...[...row, usage].map((box) => box.y + box.height),
          );
          expect(expandedWall.y).toBeGreaterThanOrEqual(toolsBottom);
          expect(expandedWall).toEqual(firstWall);
          expect(await boxes(title)).toEqual([heading]);
          expect(await boxes(map)).toEqual([viewport]);
          expect(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth -
                document.documentElement.clientWidth,
            ),
          ).toBe(0);

          // 펼친 상태에서도 표시 영역 왼쪽의 투명한 부분을 눌러 닫습니다.
          await page.touchscreen.tap(
            Math.round((row[0].x + expandedFace.x) / 2),
            Math.round(centerY),
          );
          await expect(controls).toBeHidden();
          expect(await boxes(open)).toEqual([collapsedHit]);
          expect(await boxes(bookmarkFace)).toEqual([collapsedFace]);

          await page.touchscreen.tap(
            Math.round(collapsedFace.x + collapsedFace.width / 2),
            Math.round(centerY),
          );
          await expect(controls).toBeVisible();
          await page.touchscreen.tap(1, Math.round(centerY));
          await expect(controls).toBeHidden();
          await expect(usageValue).toBeHidden();
          expect(await boxes(open)).toEqual([collapsedHit]);
          expect(await boxes(bookmarkFace)).toEqual([collapsedFace]);
          expect(await boxes(title)).toEqual([heading]);
          expect(await boxes(map)).toEqual([viewport]);
          expect(await boxes(wall)).toEqual([firstWall]);
          if (mode === 'world') {
            await open.tap();
            await page.locator('.mode-switch').tap();
            await close.tap();
            await expect(controls).toBeHidden();
          }
        }
      });

      test('책갈피는 키보드로 열고 닫으며 설정 창은 한 번의 탭으로 열린다', async ({
        page,
      }) => {
        const open = page.getByRole('button', { name: '상단 도구 열기' });
        const close = page.getByRole('button', { name: '상단 도구 접기' });
        const refresh = page.getByRole('button', { name: '새로 고침' });
        const controls = page.locator('.world-controls');

        await page.keyboard.press('Tab');
        await expect(open).toBeFocused();
        await page.keyboard.press('Tab');
        expect(
          await controls.evaluate((node) =>
            node.contains(document.activeElement),
          ),
        ).toBe(false);
        await open.focus();
        await page.keyboard.press('Enter');
        await expect(close).toBeFocused();
        for (const name of [
          '새로 고침',
          '간단 모드',
          '저장소 추가',
          'GitHub 연결',
        ]) {
          await page.keyboard.press('Tab');
          await expect(
            page.getByRole('button', { name, exact: true }),
          ).toBeFocused();
        }
        await page.keyboard.press('Escape');
        await expect(open).toBeFocused();
        await expect(refresh).toBeHidden();

        for (const name of ['저장소 추가', 'GitHub 연결']) {
          await open.tap();
          await controls.getByRole('button', { name, exact: true }).tap();
          const dialog = page.getByRole('dialog');
          await expect(dialog).toBeVisible();
          await expect(controls).toBeHidden();
          await dialog.getByRole('button', { name: '닫기' }).tap();
          await expect(dialog).toBeHidden();
        }
      });

      test('터치로 누르는 요소가 충분히 크다', async ({ page }) => {
        const bookmark = page.locator('.header-bookmark');
        await bookmark.tap();
        const targets = [
          ...(await boxes(
            page.locator('.header-bookmark, .world-controls > button'),
          )),
          ...(await boxes(page.locator('.facility-marker'))),
          ...(await boxes(page.locator('.heritage-slot'))),
          ...(await boxes(
            page.locator('.branch-road-node[data-road-role="road"]'),
          )),
        ];
        expect(targets).toHaveLength(5 + 4 + 3 + 4);
        for (const box of targets) {
          expect(Math.round(box.width)).toBeGreaterThanOrEqual(touchTarget);
          expect(Math.round(box.height)).toBeGreaterThanOrEqual(touchTarget);
        }

        await bookmark.tap();
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
        await expect(page.locator('.header-bookmark')).toBeHidden();
        await expect(
          page.getByRole('heading', { name: 'Agentopia' }),
        ).toBeInViewport({ ratio: 1 });
        const buttons = page.locator('.world-controls > button:visible');
        await expect(buttons).toHaveCount(4);
        const row = await boxes(buttons);
        for (const [index, name] of [
          '간단 모드',
          '저장소 추가',
          'GitHub 연결',
          '새로 고침',
        ].entries()) {
          const button = buttons.nth(index);
          await expect(button).toHaveAccessibleName(name);
          if (index > 0) {
            const previous = row[index - 1];
            expect(row[index].x).toBeGreaterThanOrEqual(
              previous.x + previous.width,
            );
          }
          await page.keyboard.press('Tab');
          await expect(button).toBeFocused();
        }
        await expectUsageBelowRefresh(page);
        await page.getByRole('button', { name: '간단 모드' }).click();
        await expect(page.locator('[data-display-mode]')).toHaveAttribute(
          'data-display-mode',
          'simple',
        );
      });
    }
  });
}
