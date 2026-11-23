import { alpha } from './fixtures.ts';
import { openWorld } from './github.ts';
import { expect, test } from './test.ts';

test.describe('상세 창', () => {
  test('PR 시설: 상태와 활동을 보여 주고, 눌렀을 때만 기록을 조회한다', async ({
    page,
  }) => {
    const github = await openWorld(page);
    await page.getByRole('button', { name: /PR #11/ }).click();
    const dialog = page.getByRole('dialog', { name: 'PR #11' });

    await expect(
      dialog.getByRole('heading', { name: '✨ 지도: 새 시설 추가' }),
    ).toBeVisible();
    await expect(dialog.getByText('제작 중')).toBeVisible();
    await expect(dialog.getByText('작성 · Codex')).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: '커밋 3개' }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: '댓글 2개' }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: '리뷰 1개' }),
    ).toBeVisible();
    expect(github.count('activity')).toBe(0);

    await dialog.getByRole('button', { name: '커밋 3개' }).click();
    await expect(dialog.getByRole('link', { name: 'a1b2c3d' })).toBeVisible();
    await expect(dialog.getByText('시설 배치 계산 추가')).toBeVisible();
    // 기록은 누른 종류만 한 번 조회하고, 집계가 응답에 다 있었으므로
    // 창을 열 때 집계 요청은 없었습니다.
    expect(github.count('activity')).toBe(1);
    expect(github.count('summary')).toBe(0);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('PR 시설: 집계가 없으면 한 번 조회해 채운다', async ({ page }) => {
    const github = await openWorld(page);
    await page.getByRole('button', { name: /PR #12/ }).click();
    const dialog = page.getByRole('dialog', { name: 'PR #12' });

    await expect(
      dialog.getByRole('button', { name: '커밋 2개' }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: '댓글 5개' }),
    ).toBeVisible();
    await expect(dialog.getByRole('img', { name: '실행 실패' })).toBeVisible();
    await expect(dialog.getByRole('link', { name: /CI/ })).toBeVisible();
    expect(github.count('summary')).toBe(1);
  });

  test('PR 시설에서 연결된 이슈로 넘어간다', async ({ page }) => {
    await openWorld(page);
    await page.getByRole('button', { name: /PR #11/ }).click();
    await page
      .getByRole('dialog', { name: 'PR #11' })
      .getByRole('link', { name: '이슈 #1' })
      .click();

    await expect(page.getByRole('dialog', { name: 'PR #11' })).toBeHidden();
    await expect(
      page
        .getByRole('dialog', { name: '이슈 #1' })
        .getByRole('heading', { name: '상위 과제: 지도 개편' }),
    ).toBeVisible();
  });

  test('몬스터: 이슈 상태, 활동량, 공략 결과를 보여 준다', async ({ page }) => {
    const github = await openWorld(page);
    await page.getByRole('button', { name: /^이슈 #1 / }).click();
    const dialog = page.getByRole('dialog', { name: '이슈 #1' });

    await expect(dialog.getByText('모험가 전투')).toBeVisible();
    const totals = dialog.locator('.activity-totals');
    await expect(totals.getByText('고유 커밋')).toBeVisible();
    await expect(totals.locator('dd')).toHaveText(['3', '4', '2', '1']);
    await expect(
      dialog.getByRole('link', { name: /PR #11 · ✨ 지도: 새 시설 추가/ }),
    ).toBeVisible();
    // 댓글 기록을 열어 그 요청이 도착한 뒤에, 그 전에 집계 요청이 없었음을 확인합니다.
    await dialog.getByRole('button', { name: '댓글 4개' }).click();
    await expect(dialog.locator('.activity-entry')).toHaveCount(2);
    expect(github.count('activity')).toBe(1);
    expect(github.count('summary')).toBe(0);

    await dialog.getByRole('button', { name: '닫기' }).click();
    await expect(dialog).toBeHidden();
  });

  test('몬스터: 실패한 이슈는 사유를 보여 준다', async ({ page }) => {
    await openWorld(page);
    await page.getByRole('button', { name: /^이슈 #2 / }).click();
    const dialog = page.getByRole('dialog', { name: '이슈 #2' });

    await expect(dialog.getByText('품질 시험이 실패했습니다.')).toBeVisible();
    await expect(dialog.getByRole('img', { name: '실행 실패' })).toBeVisible();
  });

  test('개발 광장: 작업 중인 시설과 시설 이력을 나눠 보여 준다', async ({
    page,
  }) => {
    await openWorld(page);
    await page.getByRole('button', { name: '개발 광장 · dev' }).click();
    const dialog = page.getByRole('dialog', { name: '개발 광장' });

    const current = dialog.locator('.quest-tree').first();
    await expect(current.locator('.quest-row small')).toHaveText([
      'PR #11',
      'PR #12',
      'PR #13',
    ]);

    // 이력은 끝난 시각이 최근인 순서입니다.
    await dialog.getByText('시설 이력').click();
    await expect(
      dialog.locator('.facility-history .quest-row small'),
    ).toHaveText(['PR #9', 'PR #8']);

    await dialog.getByRole('button', { name: /PR #13/ }).click();
    await expect(page.getByRole('dialog', { name: 'PR #13' })).toBeVisible();
  });

  test('왕궁: 배포 기록을 최신 순으로 10개씩 보여 준다', async ({ page }) => {
    await openWorld(page);
    await page.getByTitle('왕궁 · main').click();
    const dialog = page.getByRole('dialog', { name: alpha });
    const rows = dialog.locator('.release-row');

    await expect(rows).toHaveCount(10);
    // 릴리스와 같은 이름의 태그는 한 줄로 합치고, 시각은 KST로 적습니다.
    await expect(rows.nth(0)).toContainText('v1.3.0');
    await expect(rows.nth(0)).toContainText('릴리스');
    await expect(rows.nth(0).locator('time')).toHaveText(/11\. 22\. 10:00/);
    await expect(rows.nth(1)).toContainText('prod-11');
    await expect(rows.nth(1)).toContainText('태그 · 커밋');

    await dialog.getByRole('button', { name: '더 보기 (10/12)' }).click();
    await expect(rows).toHaveCount(12);
    await expect(dialog.getByRole('button', { name: /더 보기/ })).toBeHidden();

    const times = await rows
      .locator('time')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('datetime')),
      );
    expect(times).toHaveLength(12);
    expect(times).toEqual([...times].sort().reverse());
  });

  test('유산: 누적 합계와 집계 기준을 보여 준다', async ({ page }) => {
    await openWorld(page);
    await page.getByRole('button', { name: '완공 기념비' }).click();
    const dialog = page.getByRole('dialog', { name: '완공 기념비' });

    await expect(dialog.getByText('머지된 PR')).toBeVisible();
    await expect(dialog.locator('dd')).toHaveText('1,234');
    await expect(dialog.getByText(/GitHub 검색 인덱스 기준/)).toBeVisible();
  });

  test('브랜치 도로: 그 브랜치의 PR을 보여 준다', async ({ page }) => {
    await openWorld(page);
    await page.getByRole('button', { name: '브랜치 feature/facility' }).click();
    const dialog = page.getByRole('dialog', { name: 'feature/facility' });

    await expect(dialog.getByText('관측된 PR 대상 · dev')).toBeVisible();
    const link = dialog.getByRole('link', { name: /PR #11 · dev/ });
    await expect(link).toContainText('열림');
    await expect(link).toHaveAttribute(
      'href',
      `https://github.com/${alpha}/pull/11`,
    );
  });
});
