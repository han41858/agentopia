import type { Locator, Page } from '@playwright/test';
import { added, alpha, noPlaza, owner } from './fixtures.ts';
import { openWorld, settled } from './github.ts';
import { expect, test } from './test.ts';

const token = 'github_pat_ui_test';

function savedRepositories(page: Page) {
  return page.evaluate(() => {
    const saved = localStorage.getItem('agentopia.github-settings');
    const settings = JSON.parse(saved ?? '{}') as {
      repositories?: { slug: string }[];
    };
    return settings.repositories?.map(({ slug }) => slug);
  });
}

test.describe('저장소 설정', () => {
  test('owner/repo로 추가하면 왕국이 생기고 새로 고침해도 남는다', async ({
    page,
  }) => {
    const github = await openWorld(page);
    await page.getByRole('button', { name: '저장소 추가' }).click();
    const dialog = page.getByRole('dialog', { name: '저장소 추가' });
    await dialog.getByLabel('GitHub 계정 또는 저장소').fill(added);
    await dialog.getByRole('button', { name: '추가', exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole('region', { name: 'added' })).toBeVisible();
    expect(github.count('repository', added)).toBe(1);
    await expect.poll(() => savedRepositories(page)).toEqual([alpha, added]);

    await page.reload();
    await settled(page);
    await expect(page.getByRole('region', { name: 'added' })).toBeVisible();
  });

  test('계정 이름으로 목록을 열어 골라서 추가한다', async ({ page }) => {
    await openWorld(page);
    await page.getByRole('button', { name: '저장소 추가' }).click();
    const dialog = page.getByRole('dialog', { name: '저장소 추가' });
    await dialog.getByLabel('GitHub 계정 또는 저장소').fill(owner);
    await dialog.getByRole('button', { name: '목록 보기' }).click();

    // 이미 있는 저장소는 다시 고를 수 없습니다.
    const options = dialog.getByRole('group', { name: '저장소 선택' });
    await expect(options.getByLabel(alpha)).toBeDisabled();
    await expect(options.getByText('추가됨')).toHaveCount(1);
    const addSelected = dialog.getByRole('button', {
      name: '선택한 저장소 추가',
    });
    await expect(addSelected).toBeDisabled();

    await options.getByLabel(added).check();
    await options.getByLabel(noPlaza).check();
    await addSelected.click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole('region', { name: 'added' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'noplaza' })).toBeVisible();
    await expect
      .poll(() => savedRepositories(page))
      .toEqual([alpha, added, noPlaza]);
  });

  test('이미 있는 저장소를 입력하면 그 왕궁 창을 연다', async ({ page }) => {
    const github = await openWorld(page);
    await page.getByRole('button', { name: '저장소 추가' }).click();
    const dialog = page.getByRole('dialog', { name: '저장소 추가' });
    await dialog
      .getByLabel('GitHub 계정 또는 저장소')
      .fill(`https://github.com/${alpha}`);
    await dialog.getByRole('button', { name: '추가', exact: true }).click();

    await expect(page.getByRole('dialog', { name: alpha })).toBeVisible();
    await expect(page.getByRole('region')).toHaveCount(2); // 지도 영역 + 왕국 1개
    expect(github.count('repository')).toBe(0);
  });

  test('잘못된 입력은 요청 없이 안내한다', async ({ page }) => {
    const github = await openWorld(page);
    await page.getByRole('button', { name: '저장소 추가' }).click();
    const dialog = page.getByRole('dialog', { name: '저장소 추가' });
    await dialog.getByLabel('GitHub 계정 또는 저장소').fill('a/b/c');
    await dialog.getByRole('button', { name: '추가', exact: true }).click();

    await expect(dialog.getByRole('alert')).toHaveText(
      'owner, owner/repo 또는 GitHub 저장소 주소를 입력하세요.',
    );
    expect(github.count('repository')).toBe(0);
    expect(github.count('owner')).toBe(0);
  });

  test('왕궁 창에서 확인을 거쳐 월드맵에서 제거한다', async ({ page }) => {
    await openWorld(page, [alpha, noPlaza]);
    await page.getByTitle('왕궁 · main').first().click();
    const palace = page.getByRole('dialog', { name: alpha });
    await expect(palace.getByRole('button', { name: '닫기' })).toBeVisible();
    const openConfirm = palace.getByRole('button', { name: '월드맵에서 제거' });
    const confirm = page.getByRole('dialog', { name: '월드맵에서 제거' });

    await openConfirm.click();
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(`${alpha} 저장소를`);
    await expect(confirm.getByRole('button', { name: '닫기' })).toHaveCount(0);

    // 취소하면 저장소를 유지하고 왕궁 창으로 돌아갑니다.
    await confirm.getByRole('button', { name: '취소', exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(palace).toBeVisible();
    await expect(page.getByRole('region', { name: 'alpha' })).toBeVisible();

    await openConfirm.click();
    await expect(confirm).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await expect(palace).toBeVisible();

    await openConfirm.click();
    await expect(confirm).toBeVisible();
    await page.mouse.click(1, 1);
    await expect(confirm).toBeHidden();
    await expect(palace).toBeVisible();

    await openConfirm.click();
    await confirm.getByRole('button', { name: '제거', exact: true }).click();

    await expect(confirm).toBeHidden();
    await expect(page.getByRole('region', { name: 'alpha' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'noplaza' })).toBeVisible();
    await expect.poll(() => savedRepositories(page)).toEqual([noPlaza]);
  });
});

test.describe('GitHub 토큰', () => {
  test('연결하면 요청에 토큰을 싣고, 해제하면 싣지 않는다', async ({
    page,
  }) => {
    const github = await openWorld(page);
    expect(github.calls.every((call) => !call.authorization)).toBe(true);

    await page.getByRole('button', { name: 'GitHub 연결' }).click();
    const connect = page.getByRole('dialog', { name: 'GitHub 연결' });
    await connect.getByLabel('GitHub 토큰').fill(token);
    const before = github.calls.length;
    await connect.getByRole('button', { name: '토큰 연결' }).click();

    // 연결 뒤에는 바로 저장소를 고를 수 있게 추가 창이 열립니다.
    const add = page.getByRole('dialog', { name: '저장소 추가' });
    await expect(add).toBeVisible();
    await add.getByRole('button', { name: '닫기' }).click();
    const status = page.getByRole('button', { name: '토큰 접근 확인됨' });
    await expect(status).toBeVisible();
    const withToken = github.calls.slice(before);
    expect(withToken.length).toBeGreaterThan(0);
    expect(
      withToken.every((call) => call.authorization === `Bearer ${token}`),
    ).toBe(true);

    await status.click();
    const afterConnect = github.calls.length;
    await page
      .getByRole('dialog', { name: 'GitHub 연결' })
      .getByRole('button', { name: '현재 토큰 연결 해제' })
      .click();
    await expect(
      page.getByRole('button', { name: 'GitHub 연결' }),
    ).toBeVisible();
    await settled(page);
    await expect.poll(() => github.calls.length).toBeGreaterThan(afterConnect);
    expect(
      github.calls.slice(afterConnect).every((call) => !call.authorization),
    ).toBe(true);
    expect(
      await page.evaluate(() =>
        localStorage.getItem('agentopia.github-settings'),
      ),
    ).not.toContain(token);
  });
});

type VisibleArea = { height: number; offsetTop: number };

async function mockKeyboardViewport(
  page: Page,
  area: VisibleArea | null,
  event: 'resize' | 'scroll' = 'resize',
) {
  // 실제 키보드 대신 가시 영역만 바꿉니다. 레이아웃 뷰포트는 그대로 둡니다.
  await page.evaluate(
    ({ area, event }) => {
      const viewport = window.visualViewport;
      if (!viewport) throw new Error('VisualViewport is required');
      for (const key of ['height', 'offsetTop'] as const) {
        if (area) {
          Object.defineProperty(viewport, key, {
            configurable: true,
            value: area[key],
          });
        } else {
          Reflect.deleteProperty(viewport, key);
        }
      }
      viewport.dispatchEvent(new Event(event));
    },
    { area, event },
  );
}

async function expectInVisibleArea(control: Locator, area: VisibleArea) {
  await expect
    .poll(() =>
      control.evaluate((node, { height, offsetTop }) => {
        const rect = node.getBoundingClientRect();
        const body = node.closest('.dialog-body')?.getBoundingClientRect();
        return (
          rect.height > 0 &&
          rect.top >= Math.max(offsetTop, body?.top ?? offsetTop) - 1 &&
          rect.bottom <=
            Math.min(offsetTop + height, body?.bottom ?? Infinity) + 1
        );
      }, area),
    )
    .toBe(true);
}

async function tapWithoutAutoScroll(page: Page, control: Locator) {
  const box = await control.boundingBox();
  if (!box) throw new Error('Expected a touch target');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('모바일 팝업의 모의 키보드', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  for (const scenario of [
    {
      title: '저장소 추가',
      label: 'GitHub 계정 또는 저장소',
      value: owner,
      action: '목록 보기',
      offsetTop: 0,
    },
    {
      title: '저장소 추가',
      label: 'GitHub 계정 또는 저장소',
      value: added,
      action: '추가',
      offsetTop: 0,
    },
    {
      title: 'GitHub 연결',
      label: 'GitHub 토큰',
      value: token,
      action: '토큰 연결',
      offsetTop: 110,
    },
  ]) {
    test(`${scenario.action}: 입력과 본문 스크롤, 키보드 닫기 후 복원`, async ({
      page,
    }) => {
      await openWorld(page);
      const toolbar = page.getByRole('button', { name: '상단 도구 열기' });
      if (await toolbar.isVisible()) await toolbar.tap();
      await page
        .getByRole('button', { name: scenario.title, exact: true })
        .tap();

      const dialog = page.getByRole('dialog', { name: scenario.title });
      const input = dialog.getByLabel(scenario.label);
      const close = dialog.getByRole('button', { name: '닫기' });
      const heading = dialog.getByRole('heading', { name: scenario.title });
      const original = await dialog.boundingBox();
      expect(original).not.toBeNull();
      await input.tap();
      await expect(input).toBeFocused();

      const area = { height: 156, offsetTop: 0 };
      await mockKeyboardViewport(page, area);
      await expectInVisibleArea(dialog, area);
      if (scenario.offsetTop) {
        area.offsetTop = scenario.offsetTop;
        await mockKeyboardViewport(page, area, 'scroll');
      }
      await expectInVisibleArea(dialog, area);
      await expectInVisibleArea(heading, area);
      await expectInVisibleArea(close, area);
      await expectInVisibleArea(input, area);
      await page.keyboard.insertText(scenario.value);
      await expect(input).toHaveValue(scenario.value);

      // 키보드가 닫혀도 입력란이 포커스를 유지하는 경우를 검사합니다.
      await mockKeyboardViewport(page, null);
      await expect.poll(() => dialog.boundingBox()).toEqual(original);
      await expect(input).toHaveValue(scenario.value);
      await expect(input).toBeFocused();

      await mockKeyboardViewport(page, area);
      await expectInVisibleArea(dialog, area);
      await expectInVisibleArea(input, area);
      const action = dialog.getByRole('button', {
        name: scenario.action,
        exact: true,
      });
      const scrolled = await action.evaluate((button) => {
        const body = button.closest<HTMLElement>('.dialog-body');
        if (!body) throw new Error('Expected a scrollable dialog body');
        const before = body.scrollTop;
        body.scrollTop +=
          button.getBoundingClientRect().bottom -
          body.getBoundingClientRect().bottom +
          2;
        return body.scrollTop > before;
      });
      expect(scrolled).toBe(true);
      await expect(input).toBeFocused();
      await expectInVisibleArea(heading, area);
      await expectInVisibleArea(close, area);
      await expectInVisibleArea(action, area);
      await tapWithoutAutoScroll(page, action);

      if (scenario.action === '목록 보기') {
        await expect(
          dialog.getByRole('group', { name: '저장소 선택' }),
        ).toBeVisible();
        await tapWithoutAutoScroll(page, close);
        await expect(dialog).toBeHidden();
      } else if (scenario.action === '추가') {
        await expect(dialog).toBeHidden();
        await expect(page.getByRole('region', { name: 'added' })).toBeVisible();
      } else {
        await expect(dialog).toBeHidden();
        await expect(
          page.getByRole('dialog', { name: '저장소 추가' }),
        ).toBeVisible();
      }
    });
  }
});

test.describe('표시 모드', () => {
  test('간단 모드로 바꿔도 배치와 요청 수가 그대로이고 선택이 유지된다', async ({
    page,
  }) => {
    const github = await openWorld(page);
    const toggle = page.getByRole('button', { name: '간단 모드' });
    const root = page.locator('[data-display-mode]');
    await expect(root).toHaveAttribute('data-display-mode', 'world');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveAccessibleDescription('현재: 월드 모드');

    const positions = () =>
      page
        .locator(
          '.kingdom, .heritage-slot, .branch-road-node, .facility-marker, .monster-marker',
        )
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const box = node.getBoundingClientRect();
            return [box.x, box.y, box.width, box.height].map(Math.round);
          }),
        );
    const before = await positions();
    const requests = github.calls.length;

    await toggle.click();
    await expect(root).toHaveAttribute('data-display-mode', 'simple');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAccessibleDescription('현재: 간단 모드');
    await expect.poll(positions).toEqual(before);
    // 이후에 보낸 요청(PR #12 집계)이 도착할 때까지 모드 전환으로 생긴 요청이 없습니다.
    await page.getByRole('button', { name: /PR #12/ }).click();
    await expect(
      page.getByRole('dialog').getByRole('button', { name: '커밋 2개' }),
    ).toBeVisible();
    expect(github.calls.slice(requests).map(({ kind }) => kind)).toEqual([
      'summary',
    ]);
    await page.keyboard.press('Escape');

    await page.reload();
    await settled(page);
    await expect(root).toHaveAttribute('data-display-mode', 'simple');

    // 같은 단추를 다시 누르면 월드 모드로 돌아옵니다.
    await toggle.click();
    await expect(root).toHaveAttribute('data-display-mode', 'world');
    await expect.poll(positions).toEqual(before);
  });
});
