import type { Quest } from '../server/model.ts';
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
        const expected =
          id === 'PR #12' ? `${id} · ${title} · 실행 실패` : `${id} · ${title}`;
        await expect(marker).toHaveAttribute('title', expected);
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

  for (const mode of ['world', 'simple'] as const) {
    test(`${mode} 모드에서 이슈 파티는 실행 시작부터 종료까지 현재 역할을 표시한다`, async ({
      page,
    }) => {
      await openWorld(page, [alpha], mode);
      const base = alphaReport.quests.find(({ number }) => number === 4)!;
      const codex = { agent: 'codex', roles: ['develop'] } as const;
      const claude = { agent: 'claude', roles: ['review'] } as const;
      const developers = { agent: codex.agent, roles: [...codex.roles] };
      const reviewers = { agent: claude.agent, roles: [...claude.roles] };
      let quest: Quest = {
        ...base,
        pulls: [],
        stage: 'queued',
        adventurers: [],
      };
      await page.route('**/api/github?**', async (route) => {
        const params = new URL(route.request().url()).searchParams;
        if (params.get('repo') !== alpha || params.has('heritage')) {
          await route.fallback();
          return;
        }
        await route.fulfill({
          json: {
            ...alphaReport,
            quests: alphaReport.quests.map((item) =>
              item.number === quest.number ? quest : item,
            ),
          },
        });
      });

      const marker = page.getByRole('button', { name: /^이슈 #4 · / });
      const party = marker.locator('.expedition-number + .adventurer-party');
      const leader = party.locator('.resting-party-leader');
      const moving = party.locator('.adventurer-glyph.active');
      await page.reload();
      await expect(page.locator('[data-display-mode]')).toHaveAttribute(
        'data-display-mode',
        mode,
      );
      await expect(marker).toHaveAccessibleName(/작업 대기 중/);
      await expect(party).toHaveCount(0);

      quest = { ...quest, stage: 'developing', issueLeader: 'resting' };
      await page.reload();
      await expect(marker).toHaveAccessibleName(/GitHub Actions · 파티장/);
      await expect(leader).toBeVisible();
      await expect(party.locator('.adventurer-glyph')).toHaveCount(0);

      quest = {
        ...quest,
        adventurers: [{ ...developers, active: 'develop' }],
      };
      await page.reload();
      await expect(marker).toHaveAccessibleName(/Codex · 개발 중/);
      await expect(moving).toHaveCount(1);
      await expect(moving).toHaveClass(/codex active develop/);

      quest = {
        ...quest,
        stage: 'reviewing',
        adventurers: [developers, { ...reviewers, active: 'review' }],
      };
      await page.reload();
      await expect(marker).toHaveAccessibleName(
        /Codex · 대기 · Claude · 리뷰 중/,
      );
      await expect(leader).toBeVisible();
      await expect(moving).toHaveCount(1);
      await expect(moving).toHaveClass(/claude active review/);
      await expect(party.locator('.adventurer-glyph.codex')).toBeVisible();

      quest = {
        ...quest,
        stage: 'ci',
        issueCIStatus: 'waiting',
        issueLeader: 'resting',
        adventurers: [],
      };
      await page.reload();
      await expect(marker).toHaveAccessibleName(
        /GitHub Actions · CI 대기 중 · 파티장$/,
      );
      await expect(leader).toBeVisible();
      await expect(moving).toHaveCount(0);

      quest = { ...quest, issueCIStatus: 'running', issueLeader: 'active' };
      await page.reload();
      await expect(marker).toHaveAccessibleName(
        /GitHub Actions · CI 실행 중 · 파티장$/,
      );
      await expect(party).toBeVisible();
      await expect(leader).toHaveCount(0);

      quest = { ...quest, issueCIStatus: 'passed', issueLeader: 'resting' };
      await page.reload();
      await expect(marker).toHaveAccessibleName(
        /GitHub Actions · CI 성공 · 파티장$/,
      );
      await expect(leader).toBeVisible();
      await expect(moving).toHaveCount(0);

      quest = {
        ...quest,
        stage: 'returned',
        issueCIStatus: undefined,
        issueLeader: undefined,
        adventurers: [developers, reviewers],
      };
      await page.reload();
      await expect(marker).toHaveAccessibleName(/작업 종료/);
      await expect(leader).toHaveCount(0);
      await expect(moving).toHaveCount(0);
      await expect(party.locator('.adventurer-glyph')).toHaveCount(2);
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

  for (const mode of ['world', 'simple'] as const) {
    test(`${mode}: 이슈의 직속 부모와 자식만 강조한다`, async ({ page }) => {
      await openWorld(page, [alpha], mode);
      const hierarchy = [
        { number: 199 },
        { number: 200, parent: 199 },
        { number: 201, parent: 199 },
        { number: 202, parent: 199 },
        { number: 203, parent: 199 },
        { number: 204, parent: 200 },
        { number: 205 },
        { number: 206, parent: 205 },
      ];
      const quests = hierarchy.map(({ number, parent }): Quest => ({
        ...alphaReport.quests[0],
        number,
        parent,
        title: `관계 테스트 ${number}`,
        url: `https://github.com/${alpha}/issues/${number}`,
        state: 'open',
        stage: 'idle',
        subIssueCount: undefined,
        workPull: undefined,
        pulls: [],
        adventurers: [],
      }));
      await page.route('**/api/github?**', async (route) => {
        const params = new URL(route.request().url()).searchParams;
        if (
          params.get('repo') !== alpha ||
          ['owner', 'heritage', 'summary', 'activity', 'repository'].some(
            (key) => params.has(key),
          )
        ) {
          await route.fallback();
          return;
        }
        await route.fulfill({
          json: { ...alphaReport, quests: [...alphaReport.quests, ...quests] },
        });
      });
      await page.reload();

      const kingdom = page.getByRole('region', { name: 'alpha', exact: true });
      const issue = (number: number) =>
        kingdom.getByRole('button', {
          name: new RegExp(`^이슈 #${number} · `),
        });
      const related = kingdom.locator('[data-highlight="related"]');
      const palace = kingdom.getByRole('button', {
        name: 'alpha',
        exact: true,
      });

      await issue(199).hover();
      await expect(issue(199)).toHaveAttribute('data-highlight', 'selected');
      await expect(related).toHaveText(['#200', '#201', '#202', '#203']);

      await issue(200).focus();
      await expect(issue(200)).toBeFocused();
      await expect(issue(200)).toHaveAttribute('data-highlight', 'selected');
      await expect(related).toHaveText(['#199', '#204']);

      await issue(205).hover();
      await expect(issue(205)).toHaveAttribute('data-highlight', 'selected');
      await expect(related).toHaveText(['#206']);
      await page.mouse.move(2, 2);
      await expect(related).toHaveText(['#199', '#204']);

      await issue(201).focus();
      await expect(issue(201)).toHaveAttribute('data-highlight', 'selected');
      await expect(related).toHaveText(['#199']);
      await issue(204).hover();
      await palace.focus();
      await expect(related).toHaveText(['#200']);
      await page.mouse.move(2, 2);
      await expect(kingdom.locator('[data-highlight]')).toHaveCount(0);

      const facility = kingdom.getByRole('button', { name: /^PR #11 · / });
      await facility.hover();
      await expect(facility).toHaveAttribute('data-highlight', 'selected');
      await expect(issue(1)).toHaveAttribute('data-highlight', 'related');
      await issue(1).hover();
      await expect(facility).toHaveAttribute('data-highlight', 'related');
      await expect(issue(2)).toHaveAttribute('data-highlight', 'related');
      await expect(issue(199)).not.toHaveAttribute('data-highlight');

      await issue(202).click();
      await expect(
        page.getByRole('dialog', { name: '이슈 #202', exact: true }),
      ).toBeVisible();
    });
  }

  for (const mode of ['world', 'simple'] as const) {
    for (const width of [1100, 390]) {
      test(`${mode} ${width}px: 강조된 PR·이슈 연결선이 부모 마커를 우회한다`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openWorld(page, [alpha], mode);
        await page.route('**/api/github?**', async (route) => {
          const params = new URL(route.request().url()).searchParams;
          if (
            params.get('repo') !== alpha ||
            ['owner', 'heritage', 'summary', 'activity', 'repository'].some(
              (key) => params.has(key),
            )
          ) {
            await route.fallback();
            return;
          }
          await route.fulfill({
            json: {
              ...alphaReport,
              quests: alphaReport.quests.filter(({ number }) => number <= 3),
              forges: alphaReport.forges!.map((pull) =>
                pull.number === 12 ? { ...pull, issues: [2, 3] } : pull,
              ),
            },
          });
        });
        await page.reload();
        await expect(page.locator('[data-display-mode]')).toHaveAttribute(
          'data-display-mode',
          mode,
        );
        const kingdom = page.getByRole('region', {
          name: 'alpha',
          exact: true,
        });
        const issue = (number: number) =>
          kingdom.locator(`[data-road-issue="${number}"]`);
        const road = (pull: number, target: number) =>
          kingdom.locator(`[data-road-key="pr-${pull}-issue-${target}"]`);
        const blocked = road(12, 2);
        const clear = road(12, 3);
        const unrelated = road(11, 1);
        const pull = kingdom.getByRole('button', { name: /^PR #12 · / });
        await expect(blocked).toBeAttached();
        await expect(clear).toBeAttached();
        await expect(unrelated).toBeAttached();

        // Pin the real click targets relative to the measured PR marker so the
        // collision is reproducible in both modes regardless of sprite size.
        await kingdom.evaluate((region) => {
          (region as HTMLElement).style.paddingBottom = '240px';
          const area = region.getBoundingClientRect();
          const facility = region
            .querySelector('[data-road-pr="12"]')!
            .getBoundingClientRect();
          const x = facility.left + facility.width / 2;
          function place(number: number, centerX: number, top: number) {
            const marker = region.querySelector<HTMLElement>(
              `[data-road-issue="${number}"]`,
            )!;
            const rect = marker.getBoundingClientRect();
            marker.style.translate = `${centerX - rect.left - rect.width / 2}px ${top - rect.top}px`;
            return marker.getBoundingClientRect();
          }
          const side = x < area.left + area.width / 2 ? 1 : -1;
          const clearTarget = place(3, x + side * 100, facility.bottom + 22);
          // Keep the parent between the anchors, never on top of either one.
          const parent = place(
            1,
            x,
            Math.max(facility.bottom + 95, clearTarget.bottom + 24),
          );
          const blockedTarget = place(2, x, parent.bottom + 44);
          (region as HTMLElement).style.paddingBottom =
            `${240 + Math.max(0, blockedTarget.bottom + 12 - area.bottom)}px`;
          // Trigger the same remeasurement as a change to the marker list.
          region
            .querySelector('[data-road-issue="1"]')!
            .closest('ul')!
            .append(document.createComment('measure pinned markers'));
        });

        const geometry = () =>
          blocked.evaluate((element) => {
            const path = element as unknown as SVGPathElement;
            const region = path.closest('.kingdom-region')!;
            const origin = region.getBoundingClientRect();
            const parent = region
              .querySelector('[data-road-issue="1"]')!
              .getBoundingClientRect();
            const matrix = path.getScreenCTM()!;
            const length = path.getTotalLength();
            const steps = Math.max(1, Math.ceil(length * 2));
            let clearance = Infinity;
            for (let index = 0; index <= steps; index++) {
              const { x, y } = path
                .getPointAtLength((length * index) / steps)
                .matrixTransform(matrix);
              clearance = Math.min(
                clearance,
                Math.max(
                  parent.left - x,
                  x - parent.right,
                  parent.top - y,
                  y - parent.bottom,
                ),
              );
            }
            return {
              clearance,
              length,
              parent: {
                x: parent.left - origin.left,
                y: parent.top - origin.top,
                width: parent.width,
                height: parent.height,
              },
            };
          });
        await expect
          .poll(async () => (await geometry()).clearance)
          .toBeLessThan(0);
        const overview = await geometry();
        const defaultPath = (await blocked.getAttribute('d'))!;
        await testInfo.attach('기본 연결선과 부모 마커 측정값', {
          body: JSON.stringify({ ...overview, path: defaultPath }, null, 2),
          contentType: 'application/json',
        });
        const clearPath = (await clear.getAttribute('d'))!;
        const dimmed = kingdom.locator('.branch-road-lines [data-dimmed]');

        async function expectOverview() {
          await expect(blocked).toHaveAttribute('data-active', 'false');
          await expect(blocked).toHaveAttribute('d', defaultPath);
          await expect(clear).toHaveAttribute('d', clearPath);
          await expect(dimmed).toHaveCount(0);
        }

        await pull.hover();
        await expect(issue(2)).toHaveAttribute('data-highlight', 'related');
        await expect(blocked).toHaveAttribute('data-active', 'true');
        await expect(blocked).not.toHaveAttribute('d', defaultPath);
        await expect(clear).toHaveAttribute('data-active', 'true');
        await expect(clear).toHaveAttribute('d', clearPath);
        await expect(unrelated).toHaveCSS('opacity', '0.55');
        const hovered = await geometry();
        const detour = (await blocked.getAttribute('d'))!;
        await testInfo.attach('PR 호버 우회선 측정값', {
          body: JSON.stringify({ ...hovered, path: detour }, null, 2),
          contentType: 'application/json',
        });
        expect(hovered.clearance).toBeGreaterThan(2.75);
        expect(hovered.parent).toEqual(overview.parent);

        await page.mouse.move(2, 2);
        await expectOverview();
        await issue(2).focus();
        await expect(issue(2)).toBeFocused();
        await expect(pull).toHaveAttribute('data-highlight', 'related');
        await expect(blocked).toHaveAttribute('data-active', 'true');
        await expect(blocked).toHaveAttribute('d', detour);
        await expect(clear).toHaveAttribute('data-dimmed', 'true');
        const focused = await geometry();
        await testInfo.attach('이슈 키보드 포커스 우회선 측정값', {
          body: JSON.stringify(focused, null, 2),
          contentType: 'application/json',
        });
        expect(focused.clearance).toBeGreaterThan(2.75);
        expect(focused.parent).toEqual(overview.parent);

        await kingdom.getByTitle('왕궁 · main').focus();
        await expectOverview();
      });
    }
  }

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
    await expect(unbadgedArt.first()).toBeVisible();
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

    let kind: 'waiting' | 'repairing' | 'checking' = 'waiting';
    let ciQueued = false;
    const stopped = { kind: 'stopped', reason: '편집 충돌 확인' };
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
      const recovery = { kind, attempt: 1, limit: 1 };
      const stage =
        kind === 'waiting' ? 'queued' : kind === 'checking' ? 'ci' : 'revising';
      await route.fulfill({
        json: {
          ...alphaReport,
          quests: alphaReport.quests.map((quest) => {
            if (quest.number === 1)
              return {
                ...quest,
                stage,
                adventurers:
                  kind === 'repairing'
                    ? [
                        {
                          agent: 'codex',
                          roles: ['develop'],
                          active: 'develop',
                        },
                      ]
                    : adventurers,
                issueRecoveryBadge: recovery,
              };
            if (quest.number === 4)
              return {
                ...quest,
                stage: 'attention',
                pulls: [],
                adventurers: [
                  { agent: 'codex', roles: ['develop'], fallen: true },
                  { agent: 'claude', roles: ['review'] },
                ],
                issueRecoveryBadge: stopped,
              };
            if (quest.number === 2 || quest.number === 3)
              return {
                ...quest,
                ...(quest.number === 3
                  ? {
                      stage: 'failed',
                      reason: '테스트 실패',
                      adventurers: [],
                      issueLeader: undefined,
                    }
                  : { issueRecoveryBadge: stopped }),
              };
            return quest;
          }),
          forges: alphaReport.forges!.map((pull) => {
            if (pull.number === 11)
              return {
                ...pull,
                stage,
                ciQueued,
                adventurers:
                  kind === 'repairing'
                    ? [
                        {
                          agent: 'codex',
                          roles: ['develop'],
                          active: 'develop',
                        },
                      ]
                    : adventurers,
                recoveryBadge: recovery,
              };
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
          ? /사람 확인 필요 · 편집 충돌 확인/
          : /재시도 대기 · 1\/1회/;
        await expect(marker).toHaveAttribute('title', description);
        await expect(marker).toHaveAccessibleName(description);
        if (isStopped) await expect(marker).toHaveClass(/blocked/);
        else await expect(marker).not.toHaveClass(/blocked/);
        const badge = marker.locator(`svg.${kind}-recovery`);
        await expect(badge).toBeVisible();

        const characters = marker.locator('.adventurer');
        const anchor = (await characters.count())
          ? name === '이슈 #4'
            ? characters.first()
            : characters.last()
          : marker.locator(
              kind === 'monster' ? '.monster-glyph' : '.facility-sprite',
            );
        await expect(badge).toHaveClass(
          isStopped ? /circle-(help|question-mark)/ : /pause/,
        );
        const artBox = (await anchor.boundingBox())!;
        const glyphBox = (await badge.boundingBox())!;
        expect(glyphBox.y + glyphBox.height / 2).toBeLessThan(
          artBox.y + artBox.height / 2,
        );
        expect(glyphBox.x + glyphBox.width / 2).toBeGreaterThan(
          artBox.x + artBox.width / 2,
        );
      }
      const failed = kingdom.locator('[data-road-issue="3"]');
      await expect(
        failed.locator('.monster-marker-art .lucide-square'),
      ).toBeVisible();
      await expect(failed).toHaveAttribute('title', /실행 실패 · 테스트 실패/);

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
                element.querySelectorAll('.monster-glyph, .expedition-number'),
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
      for (const next of [
        'repairing',
        'checking',
        'checking',
        'waiting',
      ] as const) {
        ciQueued = next === 'checking' && kind !== 'checking';
        kind = next;
        await page.reload();
        const pull = kingdom.locator('[data-road-pr="11"] .facility-marker');
        const issue = kingdom.locator('[data-road-issue="1"]');
        for (const marker of [issue, pull]) {
          const queuedCheck = marker === pull && ciQueued;
          await expect(marker).toHaveAttribute(
            'data-recovery',
            queuedCheck ? 'waiting' : kind,
          );
          await expect(
            marker.locator('.monster-recovery, .facility-recovery'),
          ).toHaveCount(kind === 'waiting' || queuedCheck ? 1 : 0);
        }
        if (kind === 'repairing' && viewport === 'desktop') {
          for (const marker of [issue, pull])
            await expect(
              marker.locator('.adventurer-glyph.active .adventurer-avatar'),
            ).not.toHaveCSS('animation-name', 'none');
        }
        if (kind === 'checking') {
          await expect(
            pull.locator(
              ciQueued ? '.resting-party-leader' : '.working-party-leader',
            ),
          ).toBeVisible();
        }
      }
    }
  });
}
