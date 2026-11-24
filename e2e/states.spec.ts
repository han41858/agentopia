import { alpha, denied, deniedMessage, empty, noPlaza } from './fixtures.ts';
import { mockGitHub, openWorld, seedSettings, settled } from './github.ts';
import { expect, test } from './test.ts';

test.describe('예외 상태', () => {
  test('조회 중에는 갱신 단추가 바쁨 상태이고 왕궁 창이 조회 중임을 알린다', async ({
    page,
  }) => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockGitHub(page, {
      hold: (call) => (call.kind === 'report' ? gate : undefined),
    });
    await seedSettings(page, [alpha]);
    await page.goto('/');

    const refresh = page.getByRole('button', { name: '새로 고침' });
    await expect(refresh).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('.facility-marker')).toHaveCount(0);
    await page.locator('.kingdom').click();
    const dialog = page.getByRole('dialog', { name: alpha });
    await expect(
      dialog.getByText('배포 기록을 조회하고 있습니다.'),
    ).toBeVisible();

    release();
    await expect(refresh).toHaveAttribute('aria-busy', 'false');
    await expect(dialog.locator('.release-row')).toHaveCount(10);
    await expect(page.locator('.facility-marker')).toHaveCount(3);
  });

  test('요청이 거부된 저장소는 사유를 알리고 다른 왕국은 그대로 그린다', async ({
    page,
  }) => {
    await openWorld(page, [alpha, denied]);
    const refresh = page.getByRole('button', { name: '새로 고침' });
    await expect(refresh).toHaveAttribute('data-warning', 'true');
    await expect(refresh).toHaveAttribute(
      'title',
      '일부 GitHub 기록을 확인하지 못했습니다.',
    );

    const broken = page.getByRole('region', { name: 'denied' });
    await expect(broken.locator('.facility-marker')).toHaveCount(0);
    await expect(broken.locator('.monster-marker')).toHaveCount(0);
    await broken.locator('.kingdom').click();
    const dialog = page.getByRole('dialog', { name: denied });
    await expect(dialog.getByText(deniedMessage)).toBeVisible();
    await expect(dialog.getByText('배포 기록이 없습니다.')).toBeHidden();
    await dialog.getByRole('button', { name: '닫기' }).click();

    const healthy = page.getByRole('region', { name: 'alpha' });
    await expect(healthy.locator('.facility-marker')).toHaveCount(3);
    await expect(healthy.locator('.monster-marker')).toHaveCount(4);
  });

  test('광장(dev)이 없는 저장소는 작업 목록 단추로 PR 목록을 연다', async ({
    page,
  }) => {
    await openWorld(page, [noPlaza]);
    const kingdom = page.getByRole('region', { name: 'noplaza' });
    await expect(kingdom.locator('.branch-plaza')).toHaveCount(0);
    await expect(kingdom.locator('.facility-marker')).toHaveText(['PR #21']);

    await kingdom.getByRole('button', { name: '작업 목록' }).click();
    const dialog = page.getByRole('dialog', { name: '작업 목록' });
    await expect(dialog.locator('.quest-row small')).toHaveText(['PR #21']);
    await expect(dialog.getByText('장비 검수 중')).toBeVisible();
    await expect(
      dialog.getByRole('region', { name: '작업 이력', exact: true }),
    ).toHaveCount(0);
  });

  test('활동이 없는 저장소는 왕궁만 그리고 배포 기록이 없다고 알린다', async ({
    page,
  }) => {
    await openWorld(page, [empty]);
    const kingdom = page.getByRole('region', { name: 'empty' });
    await expect(kingdom.getByTitle('왕궁 · main')).toBeVisible();
    await expect(kingdom.locator('.facility-marker')).toHaveCount(0);
    await expect(kingdom.locator('.monster-marker')).toHaveCount(0);
    await expect(kingdom.locator('.heritage-slot')).toHaveCount(0);
    await expect(kingdom.locator('.branch-road-node')).toHaveCount(0);
    await expect(
      kingdom.getByRole('button', { name: '작업 목록' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: '새로 고침' }),
    ).toHaveAttribute('data-warning', 'false');

    await kingdom.locator('.kingdom').click();
    await expect(
      page
        .getByRole('dialog', { name: empty })
        .getByText('배포 기록이 없습니다.'),
    ).toBeVisible();
  });

  test('저장소가 하나도 없으면 갱신 단추를 끈다', async ({ page }) => {
    const github = await mockGitHub(page);
    await seedSettings(page, []);
    await page.goto('/');

    await expect(
      page.getByRole('button', { name: '새로 고침' }),
    ).toBeDisabled();
    await expect(
      page.getByRole('region', { name: '저장소 왕국' }),
    ).toBeVisible();
    await expect(page.locator('.kingdom-region')).toHaveCount(0);
    await settled(page);
    expect(github.calls).toHaveLength(0);
  });
});
