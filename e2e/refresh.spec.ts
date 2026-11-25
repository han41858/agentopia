import { alpha, alphaReport, empty, noPlaza } from './fixtures.ts';
import { mockGitHub, openWorld, seedSettings, settled } from './github.ts';
import type { Call } from './github.ts';
import { expect, test } from './test.ts';

const summary = (calls: Call[]) =>
  calls.map((call) => `${call.kind} ${call.repo}`).sort();

test.describe('갱신 요청 수', () => {
  test('첫 로드는 저장소마다 왕국 1회, 유산 1회만 요청한다', async ({
    page,
  }) => {
    const github = await openWorld(page, [alpha, noPlaza]);
    await expect(page.locator('.heritage-slot')).toHaveCount(3);

    expect(summary(github.calls)).toEqual([
      `heritage ${alpha}`,
      `heritage ${noPlaza}`,
      `report ${alpha}`,
      `report ${noPlaza}`,
    ]);
    for (const call of github.calls.filter(({ kind }) => kind === 'report')) {
      expect(call.params.get('branches')).toBe('1');
      expect(call.params.has('refresh')).toBe(false);
    }
  });

  test('새로 고침 단추는 저장소마다 강제 갱신 1회만 더 보낸다', async ({
    page,
  }) => {
    const github = await openWorld(page, [alpha, noPlaza]);
    await expect(page.locator('.heritage-slot')).toHaveCount(3);
    const before = github.calls.length;

    await page.getByRole('button', { name: '새로 고침' }).click();
    await expect.poll(() => github.calls.length).toBe(before + 2);
    await settled(page);

    const extra = github.calls.slice(before);
    expect(summary(extra)).toEqual([`report ${alpha}`, `report ${noPlaza}`]);
    for (const call of extra) {
      expect(call.params.get('refresh')).toBe('1');
      expect(call.params.get('branches')).toBe('1');
    }
    await expect(page.locator('.facility-marker')).toHaveCount(4);
  });

  for (const shortcut of ['F5', 'Control+r', 'Meta+r']) {
    test(`${shortcut}: 화면은 유지하고 저장소마다 강제 갱신한다`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 480, height: 400 });
      const github = await openWorld(page, [alpha, noPlaza]);
      await expect(page.locator('.heritage-slot')).toHaveCount(3);
      await page.getByRole('button', { name: /PR #11/ }).click();
      const dialog = page.getByRole('dialog', { name: 'PR #11' });
      await expect(dialog).toBeVisible();

      const map = page.locator('.map-viewport');
      const offset = await map.evaluate((node) => {
        node.scrollTo({
          left: node.scrollWidth,
          top: node.scrollHeight,
          behavior: 'instant',
        });
        return [node.scrollLeft, node.scrollTop];
      });
      expect(offset.some((position) => position > 0)).toBe(true);

      const before = github.calls.length;
      let navigations = 0;
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) navigations++;
      });
      await page.keyboard.press(shortcut);
      await expect.poll(() => github.calls.length).toBe(before + 2);
      await settled(page);

      const extra = github.calls.slice(before);
      expect(summary(extra)).toEqual([`report ${alpha}`, `report ${noPlaza}`]);
      for (const call of extra) {
        expect(call.params.get('refresh')).toBe('1');
        expect(call.params.get('branches')).toBe('1');
      }
      expect(navigations).toBe(0);
      await expect(dialog).toBeVisible();
      await expect(page.locator('[data-display-mode="world"]')).toHaveCount(1);
      await expect(page.locator('.facility-marker')).toHaveCount(4);
      expect(
        await map.evaluate((node) => [node.scrollLeft, node.scrollTop]),
      ).toEqual(offset);
    });
  }

  test('입력 중에도 갱신할 수 있고 비대상 키와 반복 입력은 요청하지 않는다', async ({
    page,
  }) => {
    const github = await openWorld(page, [alpha], 'simple');
    await page.getByRole('button', { name: '저장소 추가' }).click();
    const dialog = page.getByRole('dialog');
    const input = dialog.locator('input').first();
    await input.press('r');
    await expect(input).toHaveValue('r');
    const before = github.count('report');

    // 실제 강력 새로고침은 브라우저마다 전달 여부가 다릅니다.
    // 합성 이벤트로 앱의 취소 여부와 요청만 검사합니다.
    for (const [init, prevented] of [
      [{ key: 'R', ctrlKey: true, shiftKey: true }, false],
      [{ key: 'R', metaKey: true, shiftKey: true }, false],
      [{ key: 'F5', shiftKey: true }, false],
      [{ key: 'F5', ctrlKey: true }, false],
      [{ key: 'F5', metaKey: true }, false],
      [{ key: 'r', ctrlKey: true, metaKey: true }, false],
      [{ key: 'r', ctrlKey: true, altKey: true }, false],
      [{ key: 'x', ctrlKey: true }, false],
      [{ key: 'r' }, false],
      [{ key: 'F5', repeat: true }, true],
      [{ key: 'r', ctrlKey: true, repeat: true }, true],
      [{ key: 'r', metaKey: true, repeat: true }, true],
    ] as const) {
      const canceled = await input.evaluate(
        (node, init) =>
          !node.dispatchEvent(
            new KeyboardEvent('keydown', {
              ...init,
              bubbles: true,
              cancelable: true,
            }),
          ),
        init,
      );
      expect(canceled, JSON.stringify(init)).toBe(prevented);
    }
    await settled(page);
    expect(github.count('report')).toBe(before);

    await page.keyboard.press('Control+r');
    await expect.poll(() => github.count('report')).toBe(before + 1);
    await settled(page);
    expect(github.queries('report').slice(before)).toEqual([
      { repo: alpha, measure: 'refresh', refresh: '1', branches: '1' },
    ]);
    await expect(dialog).toBeVisible();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('r');
    await expect(page.locator('[data-display-mode="simple"]')).toHaveCount(1);
  });

  test('자동 갱신은 주기마다 1회이고, 변화가 없으면 간격을 늘린다', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date('2026-11-22T03:00:00Z') });
    const github = await mockGitHub(page);
    await seedSettings(page, [empty]);
    await page.goto('/');
    await settled(page);
    expect(github.count('report')).toBe(1);

    const refresh = page.getByRole('button', { name: '새로 고침' });

    // 토큰 없이 첫 주기는 60초입니다.
    await expect(refresh).toHaveAttribute(
      'title',
      '다음 자동 갱신까지 약 60초',
    );
    await page.clock.fastForward(61_000);
    await expect.poll(() => github.count('report')).toBe(2);
    // 브랜치 목록은 2분에 한 번만 다시 확인합니다.
    expect(github.calls.at(-1)?.params.has('branches')).toBe(false);
    expect(github.calls.at(-1)?.params.has('refresh')).toBe(false);

    // 변화가 없었으므로 다음 주기는 90초로 늘어납니다.
    await expect(refresh).toHaveAttribute(
      'title',
      '다음 자동 갱신까지 약 90초',
    );
    await page.clock.fastForward(91_000);
    await expect.poll(() => github.count('report')).toBe(3);
    await expect(refresh).toHaveAttribute(
      'title',
      '다음 자동 갱신까지 약 135초',
    );
    expect(github.count('heritage')).toBe(1);
  });
});

test.describe('모바일 책갈피의 갱신', () => {
  test.use({ viewport: { width: 320, height: 800 }, hasTouch: true });

  test('개폐는 요청을 보내지 않고 새로 고침만 강제 갱신한다', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-11-22T03:00:00Z'));
    const github = await mockGitHub(page);
    await seedSettings(page, [empty]);
    await page.goto('/');
    const refresh = page.locator('.refresh-button');
    await expect(refresh).toBeHidden();
    await expect(refresh).toHaveAttribute('aria-busy', 'false');
    expect(github.count('report')).toBe(1);
    const before = github.calls.length;
    const open = page.getByRole('button', { name: '상단 도구 열기' });
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    const fill = page.locator('.header-bookmark .refresh-fill');
    const refreshFill = page.locator('.refresh-button .refresh-fill');
    await expect(fill).toHaveCSS('animation-duration', '60s');
    const progress = await fill.elementHandle();

    await open.tap();
    await expect(refreshFill).toHaveCSS('animation-duration', '60s');
    await page.getByRole('button', { name: '상단 도구 접기' }).tap();
    await open.tap();
    await settled(page);
    expect(github.calls).toHaveLength(before);
    expect(await progress?.evaluate((node) => node.isConnected)).toBe(true);

    await page.getByRole('button', { name: '새로 고침' }).tap();
    await expect.poll(() => github.calls.length).toBe(before + 1);
    await settled(page);
    const extra = github.calls.slice(before);
    expect(summary(extra)).toEqual([`report ${empty}`]);
    expect(extra[0].params.get('refresh')).toBe('1');
  });
});

test('PR 리뷰가 재개되면 캐릭터도 다시 움직인다', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openWorld(page);
  const report = structuredClone(alphaReport);
  const pull = report.forges!.find((item) => item.number === 11)!;
  await page.route('**/api/github?**', async (route) => {
    if (new URL(route.request().url()).searchParams.has('refresh'))
      await route.fulfill({ json: report });
    else await route.fallback();
  });
  const marker = page.getByRole('button', { name: /PR #11/ });
  const avatar = marker.locator('.claude .adventurer-avatar');
  for (const reviewing of [true, false, true]) {
    pull.stage = reviewing ? 'reviewing' : 'idle';
    pull.adventurers = [
      {
        agent: 'claude',
        roles: ['review'],
        active: reviewing ? 'review' : undefined,
      },
    ];
    await page.getByRole('button', { name: '새로 고침' }).click();
    await expect(avatar).toHaveCSS(
      'animation-name',
      reviewing ? 'review-nod' : 'none',
    );
    if (reviewing)
      await expect(avatar).toHaveCSS('animation-iteration-count', 'infinite');
  }
});

test('PR 없는 이슈에도 다음 갱신에서 작업 중인 담당자가 나타난다', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openWorld(page);
  const marker = page.locator('[data-road-issue="3"]');
  const avatar = marker.locator('.codex .adventurer-avatar');
  await expect(marker).toBeVisible();
  await expect(avatar).toHaveCount(0);
  const report = structuredClone(alphaReport);
  const issue = report.quests.find((item) => item.number === 3)!;
  issue.stage = 'developing';
  issue.adventurers = [
    { agent: 'codex', roles: ['develop'], active: 'develop' },
  ];
  await page.route('**/api/github?**', (route) =>
    new URL(route.request().url()).searchParams.has('refresh')
      ? route.fulfill({ json: report })
      : route.fallback(),
  );
  await page.getByRole('button', { name: '새로 고침' }).click();
  await expect(avatar).toBeVisible();
  await expect(avatar).toHaveCSS('animation-name', 'attack');
});
