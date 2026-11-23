import { openWorld } from './github.ts';
import { expect, labels, test } from './test.ts';

test.describe('왕국 기본 표시', () => {
  test('왕궁, 유산, 도로, 시설, 몬스터를 응답대로 그린다', async ({ page }) => {
    await openWorld(page);
    const kingdom = page.getByRole('region', { name: 'alpha' });

    await expect(kingdom.getByTitle('왕궁 · main')).toBeVisible();

    // 집계가 0인 유산(기록 보관소)은 짓지 않습니다.
    const heritage = kingdom.getByRole('group', { name: 'alpha의 유산' });
    await expect
      .poll(() => labels(heritage.getByRole('button')))
      .toEqual(['완공 기념비', '영웅의 전당', '현자의 서고']);

    const roads = kingdom.getByRole('group', { name: '브랜치 도로망' });
    await expect(roads.locator('.branch-bridge')).toBeVisible();
    await expect
      .poll(() => labels(roads.getByRole('button')))
      .toEqual([
        '개발 광장 · dev',
        '브랜치 docs/guide',
        '브랜치 feature/facility',
        '브랜치 fix/road',
      ]);

    // 머지되거나 취소된 PR(#9, #8)은 시설로 남지 않고, 도로 순서대로 놓입니다.
    const facilities = kingdom
      .getByRole('list', { name: 'alpha 왕국 내부' })
      .locator('.facility-marker');
    await expect(facilities).toHaveText(['PR #13', 'PR #11', 'PR #12']);
    await expect(facilities.nth(0)).toHaveAttribute('data-facility', 'library');
    await expect(facilities.nth(1)).toHaveAttribute('data-facility', 'forge');
    await expect(facilities.nth(2)).toHaveAttribute('data-facility', 'wall');
    await expect(facilities.nth(0)).toHaveAccessibleName(/초안/);
    await expect(facilities.nth(1)).toHaveAccessibleName(/Codex · 개발 중/);
    await expect(facilities.nth(2)).toHaveAccessibleName(/실행 실패/);

    // 닫힌 이슈(#5)는 몬스터로 나오지 않습니다.
    const monsters = kingdom
      .getByRole('list', { name: 'alpha 왕국 외부 몬스터' })
      .locator('.monster-marker');
    await expect(monsters).toHaveText(['#1', '#2', '#3', '#4']);
    await expect(monsters.nth(0)).toHaveClass(/boss-marker/);
    await expect(monsters.nth(3)).not.toHaveClass(/boss-marker/);
    await expect(
      kingdom
        .getByRole('list', { name: '이슈 #1의 하위 이슈' })
        .locator('.monster-marker'),
    ).toHaveText(['#2', '#3']);
  });

  test('기본 파티 구성 범례를 보여 준다', async ({ page }) => {
    await openWorld(page);
    await expect(
      page.getByRole('list', { name: '기본 파티 구성' }).getByRole('listitem'),
    ).toHaveText(['파티장', 'Codex', 'Claude', '포탈 관리자']);
  });

  test('시설에 올리면 연결된 몬스터를 함께 강조한다', async ({ page }) => {
    await openWorld(page);
    const facility = page.getByRole('button', { name: /PR #11/ });
    const linked = page.getByRole('button', { name: /^이슈 #1 / });
    const other = page.getByRole('button', { name: /^이슈 #4 / });

    await facility.hover();
    await expect(facility).toHaveAttribute('data-highlight', 'selected');
    await expect(linked).toHaveAttribute('data-highlight', 'related');
    await expect(other).not.toHaveAttribute('data-highlight');

    await page.mouse.move(2, 2);
    await expect(linked).not.toHaveAttribute('data-highlight');
  });
});
