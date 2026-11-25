import { alpha, alphaReport } from './fixtures.ts';
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
        '브랜치 feature/facility',
        '브랜치 fix/road',
        '브랜치 docs/guide',
      ]);

    // 머지되거나 취소된 PR(#9, #8)은 시설로 남지 않고, 도로 순서대로 놓입니다.
    const facilities = kingdom
      .getByRole('list', { name: 'alpha 왕국 내부' })
      .locator('.facility-marker');
    await expect(facilities).toHaveText(['PR #11', 'PR #12', 'PR #13']);
    await expect(facilities.nth(0)).toHaveAttribute('data-facility', 'forge');
    await expect(facilities.nth(1)).toHaveAttribute('data-facility', 'wall');
    await expect(facilities.nth(2)).toHaveAttribute('data-facility', 'library');
    await expect(facilities.nth(0)).toHaveAccessibleName(/Codex · 개발 중/);
    await expect(facilities.nth(1)).toHaveAccessibleName(/실행 실패/);
    await expect(facilities.nth(2)).toHaveAccessibleName(/초안/);

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

  for (const mode of ['world', 'simple'] as const) {
    test(`${mode} 모드에서 PR·이슈 아이콘은 원래 제목을 툴팁으로 표시한다`, async ({
      page,
    }) => {
      await openWorld(page, [alpha], mode);
      await expect(page.locator('[data-display-mode]')).toHaveAttribute(
        'data-display-mode',
        mode,
      );
      const kingdom = page.getByRole('region', { name: 'alpha' });
      const markers = [
        ['이슈 #4', alphaReport.quests.find(({ number }) => number === 4)!],
        ['이슈 #1', alphaReport.quests.find(({ number }) => number === 1)!],
        ['PR #12', alphaReport.forges!.find(({ number }) => number === 12)!],
      ] as const;

      for (const [id, { title }] of markers) {
        const marker = kingdom.getByRole('button', {
          name: new RegExp(`^${id} · `),
        });
        await expect(marker).toHaveAttribute('title', `${id} · ${title}`);
        await expect(marker.locator('[title], svg title')).toHaveCount(0);
        await marker.click();

        const dialog = page.getByRole('dialog', { name: id, exact: true });
        await expect(
          dialog.getByRole('heading', { level: 3, name: title, exact: true }),
        ).toBeVisible();
        await dialog.getByRole('button', { name: '닫기' }).click();
        await expect(dialog).toBeHidden();
      }

      const working = kingdom.getByRole('button', { name: /^PR #11 · / });
      await expect(working).toHaveAccessibleName(/Codex · 개발 중/);
      await expect(working.locator('.adventurer').first()).toBeAttached();
      await expect(working.locator('[title], svg title')).toHaveCount(0);
    });
  }

  test('기본 파티 구성 범례를 보여 준다', async ({ page }) => {
    await openWorld(page);
    await expect(
      page.getByRole('list', { name: '기본 파티 구성' }).getByRole('listitem'),
    ).toHaveText(['파티장', 'Codex', 'Claude']);
    const issue = page.getByRole('button', { name: /^이슈 #4 / });
    await expect(issue).toBeVisible();
    await expect(issue.locator('.adventurer-party')).toHaveCount(0);
    await page.getByRole('button', { name: '간단 모드' }).click();
    await expect(
      page.getByRole('list', { name: '활동 범례' }).getByRole('listitem'),
    ).toHaveText(['GitHub', 'Codex', 'Claude']);
    await expect(issue).toBeVisible();
    await expect(issue.locator('.adventurer-party')).toHaveCount(0);
  });

  test('사이트 아이콘과 홈 화면 아이콘을 제공한다', async ({ page }) => {
    await openWorld(page);
    for (const [selector, type] of [
      ['link[rel="icon"][type="image/svg+xml"]', 'image/svg+xml'],
      ['link[rel="icon"][type="image/png"]', 'image/png'],
      ['link[rel="apple-touch-icon"]', 'image/png'],
    ]) {
      const href = await page.locator(selector).getAttribute('href');
      expect(href).toBeTruthy();
      const response = await page.request.get(href!);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain(type);
    }
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

for (const viewport of ['desktop', 'mobile']) {
  test(`${viewport}: 이슈와 PR의 복구·중단 글리프는 모드 전환 후에도 유지된다`, async ({
    page,
  }, testInfo) => {
    if (viewport === 'mobile') {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
    }
    await openWorld(page);
    const kingdom = page.getByRole('region', { name: 'alpha' });
    const unbadgedArt = kingdom.locator(
      '.monster-marker:not([data-recovery]) .monster-marker-art',
    );
    const openQuestCount = alphaReport.quests.filter(
      (quest) => quest.state === 'open',
    ).length;
    await expect(unbadgedArt).toHaveCount(openQuestCount);
    const unbadgedWidths = await unbadgedArt.evaluateAll((elements) =>
      elements.map((element) => ({
        art: element.getBoundingClientRect().width,
        glyph: element.querySelector('.monster-glyph')!.getBoundingClientRect()
          .width,
      })),
    );
    await testInfo.attach('배지 없는 이슈의 그림 영역과 글리프 너비', {
      body: JSON.stringify(unbadgedWidths, null, 2),
      contentType: 'application/json',
    });
    for (const { art, glyph } of unbadgedWidths) {
      expect(glyph).toBeGreaterThan(0);
      expect(art).toBe(glyph);
    }

    const repairing = { kind: 'repairing', attempt: 1, limit: 1 };
    const stopped = { kind: 'stopped', reason: '사람 확인 필요' };
    const adventurers = [{ agent: 'codex', roles: ['develop'] }];
    await page.route('**/api/github?**', async (route) => {
      const query = new URL(route.request().url()).searchParams;
      if (
        query.get('repo') !== alpha ||
        [...query.keys()].some((k) =>
          ['heritage', 'activity', 'summary'].includes(k),
        )
      )
        return route.fallback();
      await route.fulfill({
        json: {
          ...alphaReport,
          quests: alphaReport.quests.map((quest) => {
            if (quest.number === 1)
              return {
                ...quest,
                stage: 'revising',
                issueRecoveryBadge: repairing,
              };
            if (quest.number === 4)
              return {
                ...quest,
                stage: 'attention',
                pulls: [],
                adventurers,
                issueRecoveryBadge: stopped,
              };
            if (quest.number === 2 || quest.number === 3)
              return {
                ...quest,
                issueRecoveryBadge: quest.number === 2 ? stopped : repairing,
              };
            return quest;
          }),
          forges: alphaReport.forges!.map((pull) => {
            if (pull.number === 11)
              return { ...pull, stage: 'revising', recoveryBadge: repairing };
            if (pull.number === 12)
              return {
                ...pull,
                stage: 'attention',
                adventurers,
                recoveryBadge: stopped,
              };
            return pull;
          }),
        },
      });
    });
    await page.reload();

    for (const mode of ['world', 'simple']) {
      if (mode === 'simple') {
        if (viewport === 'mobile')
          await page.locator('.header-bookmark').click();
        await page.getByRole('button', { name: '간단 모드' }).click();
      }
      await expect(page.locator('[data-display-mode]')).toHaveAttribute(
        'data-display-mode',
        mode,
      );
      for (const [name, kind, isStopped] of [
        ['이슈 #1', 'monster', false],
        ['이슈 #4', 'monster', true],
        ['PR #11', 'facility', false],
        ['PR #12', 'facility', true],
      ] as const) {
        const marker = page.getByRole('button', {
          name: new RegExp(`^${name} · `),
        });
        const description = isStopped
          ? /작업 중단 · 사람 확인 필요/
          : /자동 수정 중 · 1\/1회/;
        await expect(marker).toHaveAttribute('title', description);
        await expect(marker).toHaveAccessibleName(description);
        if (isStopped) await expect(marker).toHaveClass(/blocked/);
        else await expect(marker).not.toHaveClass(/blocked/);
        const badge = marker.locator(`svg.${kind}-recovery`);
        await expect(badge).toBeVisible();

        if (viewport !== 'mobile') continue;
        const targets = [
          marker.locator('.expedition-number'),
          marker.locator('.adventurer-party'),
        ];
        if (kind === 'monster') targets.push(marker.locator('.monster-glyph'));
        const badgeBox = await badge.boundingBox();
        const withBadge = await Promise.all(
          targets.map((target) => target.boundingBox()),
        );
        await badge.evaluate((element) => {
          element.style.display = 'none';
        });
        const withoutBadge = await Promise.all(
          targets.map((target) => target.boundingBox()),
        );
        await badge.evaluate((element) => {
          element.style.removeProperty('display');
        });
        await testInfo.attach(`${mode} ${name} 배지·번호·캐릭터 경계 상자`, {
          body: JSON.stringify({ badgeBox, withBadge, withoutBadge }, null, 2),
          contentType: 'application/json',
        });
        expect(badgeBox).not.toBeNull();
        expect(withBadge).toEqual(withoutBadge);
        for (const target of withBadge) {
          expect(target).not.toBeNull();
          expect(
            badgeBox!.x + badgeBox!.width <= target!.x ||
              target!.x + target!.width <= badgeBox!.x ||
              badgeBox!.y + badgeBox!.height <= target!.y ||
              target!.y + target!.height <= badgeBox!.y,
          ).toBe(true);
        }
      }

      await expect(kingdom.locator('svg.monster-recovery')).toHaveCount(4);
      const markers = await kingdom
        .locator('.monster-marker, .facility-marker')
        .evaluateAll((elements) => {
          const bounds = (element: Element) => {
            const { left, top, right, bottom } =
              element.getBoundingClientRect();
            return { left, top, right, bottom };
          };
          return elements.map((element) => {
            const badge = element.querySelector('svg.monster-recovery');
            return {
              name: element.textContent?.trim(),
              box: bounds(element),
              badge: badge ? bounds(badge) : null,
              contents: Array.from(
                element.querySelectorAll(
                  '.monster-glyph, .expedition-number, .adventurer-party',
                ),
                (target) => ({ name: target.className, box: bounds(target) }),
              ),
            };
          });
        });
      await testInfo.attach(`${mode} 이슈 배지와 이슈·PR 마커 경계 상자`, {
        body: JSON.stringify(markers, null, 2),
        contentType: 'application/json',
      });

      for (const marker of markers) {
        const { badge, box, name } = marker;
        if (!badge) continue;
        const label = `${mode} ${name} 배지`;
        expect(badge.right, label).toBeGreaterThan(badge.left);
        expect(badge.bottom, label).toBeGreaterThan(badge.top);
        expect(badge.left, label).toBeGreaterThanOrEqual(box.left);
        expect(badge.top, label).toBeGreaterThanOrEqual(box.top);
        expect(badge.right, label).toBeLessThanOrEqual(box.right);
        expect(badge.bottom, label).toBeLessThanOrEqual(box.bottom);

        const isDisjoint = (target: typeof box) =>
          badge.right <= target.left ||
          target.right <= badge.left ||
          badge.bottom <= target.top ||
          target.bottom <= badge.top;

        for (const target of marker.contents) {
          const { left, right, top, bottom } = target.box;
          if (left === right || top === bottom) continue;
          expect(
            isDisjoint(target.box),
            `${label}와 자기 마커의 ${target.name} 영역은 겹치지 않는다`,
          ).toBe(true);
        }
        for (const other of markers) {
          if (other === marker) continue;
          expect(
            isDisjoint(other.box),
            `${label}와 ${other.name} 마커는 겹치지 않는다`,
          ).toBe(true);
        }
      }
    }
  });
}
