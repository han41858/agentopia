import type { Locator } from '@playwright/test';
import { makeQuests, repositoryRegion } from '../server/model.ts';
import type { Comment, Run, SubIssue, SubIssueList } from '../server/model.ts';
import { alpha, alphaReport } from './fixtures.ts';
import { mockGitHub, openWorld, seedSettings, settled } from './github.ts';
import { expect, test } from './test.ts';

async function expectWorkflowRunRows(rows: Locator) {
  for (const [index, row] of (await rows.all()).entries()) {
    await expect(row).toHaveCSS('border-top-width', '0px');
    await expect(row).toHaveCSS(
      'margin-block-start',
      index === 0 ? '0px' : '4px',
    );
    await expect(row).toHaveCSS('margin-block-end', '0px');
    expect(
      await row.evaluate((node) => {
        const rowBox = node.getBoundingClientRect();
        const boxes = Array.from(node.children, (child) =>
          child.getBoundingClientRect(),
        );
        const center = boxes[0].top + boxes[0].height / 2;
        return boxes.every(
          (box, index) =>
            Math.abs(box.top + box.height / 2 - center) < 1 &&
            box.left >= (boxes[index - 1]?.right ?? rowBox.left) &&
            box.right <= rowBox.right + 1,
        );
      }),
    ).toBe(true);
  }
}

async function detailTextStyle(locator: Locator) {
  return locator.evaluate((node) => {
    const { fontFamily, fontSize, fontWeight, lineHeight, color } =
      getComputedStyle(node);
    return { fontFamily, fontSize, fontWeight, lineHeight, color };
  });
}

async function detailAlignment(dialog: Locator) {
  return dialog.evaluate((node) => {
    const header = node.querySelector('.dialog-heading h2')!;
    const body = node.querySelector('.dialog-body')!;
    const first = body.querySelector('h3, h4')!;
    const headerBox = header.getBoundingClientRect();
    const bodyBox = body.getBoundingClientRect();
    const firstBox = first.getBoundingClientRect();
    return {
      headerX: headerBox.left,
      headerY: headerBox.top,
      firstX: firstBox.left,
      firstY: firstBox.top - bodyBox.top + body.scrollTop,
      firstHeight: firstBox.height,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
    };
  });
}

test.describe('상세 창', () => {
  for (const mode of ['world', 'simple']) {
    for (const width of [1280, 320]) {
      test(`공통 머리글과 본문 기준선: ${mode}, ${width}px`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 720 });
        await mockGitHub(page);
        await seedSettings(page, [alpha]);
        const report = structuredClone(alphaReport);
        const pull = report.forges!.find(({ number }) => number === 12)!;
        const issue = report.quests.find(({ number }) => number === 2)!;
        const history = report.forges!.find(({ merged }) => merged)!;
        pull.title = `🐛 도로: ${'가'.repeat(1250)}`;
        issue.title = `경로 겹침: ${'나'.repeat(1250)}`;
        issue.runs = pull.runs;
        report.forges!.push(
          ...Array.from({ length: 20 }, (_, index) => ({
            ...history,
            number: 100 + index,
          })),
        );
        await page.route('**/api/github?**', async (route) => {
          const params = new URL(route.request().url()).searchParams;
          if (params.get('repo') === alpha && params.has('branches'))
            await route.fulfill({ json: report });
          else await route.fallback();
        });
        await page.goto('/');
        await settled(page);
        const simple = page.getByRole('button', { name: '간단 모드' });
        if (mode === 'simple') await simple.click();
        await expect(simple).toHaveAttribute(
          'aria-pressed',
          String(mode === 'simple'),
        );

        await page.getByRole('button', { name: /^개발 광장/ }).click();
        const plaza = page.getByRole('dialog', { name: '개발 광장' });
        const plazaHeading = plaza.getByRole('heading', { level: 2 });
        const plazaSection = plaza.getByRole('heading', { name: '작업중' });
        const plazaRow = plaza.getByRole('button', { name: /^PR #12 / });
        await expect(plazaRow).toBeVisible();
        const headerStyle = await detailTextStyle(plazaHeading);
        const sectionStyle = await detailTextStyle(plazaSection);
        const rowStyle = await detailTextStyle(plazaRow.locator('strong'));
        const metaStyle = await detailTextStyle(plazaRow.locator('small'));
        const plazaBox = await detailAlignment(plaza);
        const historyList = plaza
          .getByRole('region', { name: '작업 이력' })
          .getByRole('list');
        await historyList.getByRole('button').last().scrollIntoViewIfNeeded();
        expect(
          await historyList.evaluate((node) => node.scrollTop),
        ).toBeGreaterThan(0);
        await expect(plazaHeading).toBeInViewport();
        await expect(
          plaza.getByRole('button', { name: '닫기' }),
        ).toBeInViewport();

        await plazaRow.press('Enter');
        const pr = page.getByRole('dialog', { name: 'PR #12' });
        const prTitle = pr.getByRole('heading', { level: 3 });
        await expect(prTitle).toHaveText(pull.title);
        const titleStyle = await detailTextStyle(prTitle);
        const linkedIssue = pr.getByRole('link', {
          name: '이슈 #2',
          exact: true,
        });
        await expect(linkedIssue).toHaveAttribute(
          'href',
          `https://github.com/${alpha}/issues/2`,
        );

        const measurements = [];
        for (const dialog of [
          pr,
          page.getByRole('dialog', { name: '이슈 #2' }),
        ]) {
          const heading = dialog.getByRole('heading', { level: 2 });
          const title = dialog.getByRole('heading', { level: 3 });
          const section = dialog.getByRole('heading', {
            name: 'GitHub Actions',
          });
          const runs = dialog.getByRole('list', {
            name: 'GitHub Actions 실행 목록',
          });
          await expect(section).toBeVisible();
          expect(await detailTextStyle(heading)).toEqual(headerStyle);
          expect(await detailTextStyle(title)).toEqual(titleStyle);
          expect(await detailTextStyle(section)).toEqual(sectionStyle);
          expect(
            await detailTextStyle(runs.getByRole('link', { name: 'CI' })),
          ).toEqual(rowStyle);
          expect(await detailTextStyle(runs.locator('time'))).toEqual(
            metaStyle,
          );
          await expect(title).toHaveCSS('text-align', 'left');

          const box = await detailAlignment(dialog);
          expect(box.headerX).toBeCloseTo(plazaBox.headerX, 0);
          expect(box.firstX).toBeCloseTo(box.headerX, 0);
          expect(box.firstY).toBeCloseTo(plazaBox.firstY, 0);
          expect(box.firstHeight).toBeGreaterThan(
            2 * parseFloat(titleStyle.lineHeight),
          );
          expect(box.scrollHeight).toBeGreaterThan(box.clientHeight);
          for (const locator of [section, runs]) {
            const x = await locator.evaluate(
              (node) => node.getBoundingClientRect().left,
            );
            expect(x).toBeCloseTo(box.firstX, 0);
          }
          const scrollTop = await dialog
            .locator('.dialog-body')
            .evaluate((node) => {
              node.scrollTop = node.scrollHeight;
              return node.scrollTop;
            });
          expect(scrollTop).toBeGreaterThan(0);
          await expect(heading).toBeInViewport();
          await expect(
            dialog.getByRole('button', { name: '닫기' }),
          ).toBeInViewport();
          expect((await detailAlignment(dialog)).headerY).toBeCloseTo(
            box.headerY,
            0,
          );
          await runs.focus();
          await expect(runs).toBeFocused();
          await page.keyboard.press('Tab');
          await expect(runs.getByRole('link', { name: 'CI' })).toBeFocused();
          measurements.push({ ...box, scrollTop });
          if (dialog === pr) await linkedIssue.press('Enter');
          else await expect(title).toHaveText(issue.title);
        }
        expect(plazaBox.firstX).toBeCloseTo(plazaBox.headerX, 0);
        await testInfo.attach('상세 팝업 위치와 서체', {
          body: JSON.stringify(
            {
              plazaBox,
              measurements,
              headerStyle,
              titleStyle,
              sectionStyle,
              rowStyle,
              metaStyle,
            },
            null,
            2,
          ),
          contentType: 'application/json',
        });
      });
    }
  }

  test('PR 시설: 상태와 활동을 보여 주고, 눌렀을 때만 기록을 조회한다', async ({
    page,
  }) => {
    const github = await mockGitHub(page);
    const report = structuredClone(alphaReport);
    const pull = report.forges?.find(({ number }) => number === 11);
    if (!pull) throw new Error('alphaReport에 PR #11 픽스처가 없습니다.');
    pull.activity = { commits: 1, partialCommits: true, pullComments: 2 };
    pull.activities = { commits: 3, reviews: 1 };
    await page.route('**/api/github?**', async (route) => {
      const params = new URL(route.request().url()).searchParams;
      if (
        params.get('repo') !== alpha ||
        ['summary', 'activity', 'heritage', 'repository', 'reviews'].some(
          (key) => params.has(key),
        )
      )
        return route.fallback();
      await route.fulfill({ json: report });
    });
    await seedSettings(page, [alpha]);
    await page.goto('/');
    await settled(page);
    await page.getByRole('button', { name: /PR #11/ }).click();
    const dialog = page.getByRole('dialog', { name: 'PR #11' });

    await expect(
      dialog.getByRole('heading', { name: '✨ 지도: 새 시설 추가' }),
    ).toBeVisible();
    await expect(dialog.getByText('제작 중')).toHaveCount(0);
    await expect(dialog.getByText('AI 리뷰 결과 pass')).toBeVisible();
    await expect(dialog.getByText(/작성 ·|리뷰 기록 ·/)).toHaveCount(0);
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

    // 종류를 바꾸면 그 종류의 기록으로 바뀝니다.
    await dialog.getByRole('button', { name: '리뷰 1개' }).click();
    await expect(dialog.getByText('배치 계산을 확인했습니다.')).toBeVisible();
    await expect(dialog.getByText('시설 배치 계산 추가')).toBeHidden();

    // 누른 종류만, 이 PR 번호로 한 번씩 조회합니다. 집계는 응답에 다 있었으므로
    // 창을 열 때 집계 요청은 없었습니다.
    expect(github.queries('activity')).toEqual([
      { repo: alpha, activity: 'commits', number: '11', page: '1' },
      { repo: alpha, activity: 'reviews', number: '11', page: '1' },
    ]);
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
    await expect(dialog.locator('.badge.failed')).toHaveCount(0);
    const runs = dialog.getByRole('list', { name: 'GitHub Actions 실행 목록' });
    const latest = runs.getByRole('listitem').first();
    await expect(latest.getByRole('link', { name: 'CI' })).toBeVisible();
    await expect(latest.locator('time')).toHaveText(/2026.*1.*15.*10:00 KST/);
    const failure = latest.locator('.workflow-run-status');
    await expect(failure).toBeVisible();
    await expect(failure).toHaveText('failure');
    await expect(latest).toHaveCSS('font-size', '11px');
    expect(github.queries('summary')).toEqual([
      {
        repo: alpha,
        summary: 'pull',
        number: '12',
        counts: 'commits,comments,reviews',
      },
    ]);
  });

  test('PR 시설: 닫으면 집계를 취소하고 실패를 0으로 표시하지 않는다', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const fetch = window.fetch;
      window.fetch = (input, options) => {
        if (String(input).includes('summary=pull')) {
          options?.signal?.addEventListener('abort', () => {
            document.documentElement.dataset.summaryAborted = 'true';
          });
        }
        return fetch(input, options);
      };
    });
    const github = await openWorld(page);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    await page.route('**/api/github?**', async (route) => {
      const params = new URL(route.request().url()).searchParams;
      if (params.get('summary') !== 'pull') return route.fallback();
      if (++calls === 1) {
        await held;
        await route.abort().catch(() => {});
        return;
      }
      await route.fulfill({ status: 502, json: { error: '집계 조회 실패' } });
    });
    const marker = page.getByRole('button', { name: /PR #12/ });
    const dialog = page.getByRole('dialog', { name: 'PR #12' });
    try {
      await marker.click();
      await expect.poll(() => calls).toBe(1);
      await expect(dialog.getByRole('status')).toHaveText(
        'GitHub 활동 집계 확인 중…',
      );
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page.locator('html')).toHaveAttribute(
        'data-summary-aborted',
        'true',
      );
    } finally {
      release();
    }
    await marker.click();
    await expect(dialog.getByRole('status')).toHaveText(
      '일부 활동을 조회하지 못했습니다.',
    );
    await expect(
      dialog.getByRole('button', { name: '커밋', exact: true }),
    ).toHaveText('—');
    expect(calls).toBe(2);
    expect(github.count('activity')).toBe(0);
  });

  test('이슈와 PR 팝업에서 최신 Actions 실행을 먼저 표시한다', async ({
    page,
  }) => {
    const report = structuredClone(alphaReport);
    const runs = [
      {
        title: 'CI',
        status: 'success',
        startedAt: '2026-01-14T16:30:00Z',
      },
      {
        title: 'CI',
        status: 'in_progress',
        startedAt: '2026-01-14T16:23:45Z',
      },
      {
        title: 'CI',
        status: 'failure',
        startedAt: '2026-01-14T16:23:05Z',
      },
      {
        title: 'AI development',
        status: 'cancelled',
        startedAt: '2026-01-14T16:01:00Z',
      },
      { title: 'AI development', status: 'queued' },
    ].map((run, index) => ({
      ...run,
      url: `https://github.com/${alpha}/actions/runs/${400 + index}`,
    }));
    const issue = report.quests.find(({ number }) => number === 1)!;
    issue.runs = runs;
    issue.evidence = runs[3]!;
    report.forges!.find(({ number }) => number === 12)!.runs = runs;
    await seedSettings(page, [alpha]);
    await mockGitHub(page);
    await page.route('**/api/github?**', (route) =>
      new URL(route.request().url()).searchParams.has('branches')
        ? route.fulfill({ json: report })
        : route.fallback(),
    );
    await page.goto('/');

    for (const [button, name] of [
      [/^이슈 #1 /, '이슈 #1'],
      [/PR #12/, 'PR #12'],
    ] as const) {
      await page.getByRole('button', { name: button }).click();
      const dialog = page.getByRole('dialog', { name });
      const list = dialog.getByRole('list', {
        name: 'GitHub Actions 실행 목록',
      });
      const rows = list.getByRole('listitem');
      await expect(rows).toHaveCount(runs.length);
      await expect(list.locator('time')).toHaveText([
        /01:30 KST/,
        /01:23 KST/,
        /01:23 KST/,
        /01:01 KST/,
      ]);
      await expect(list.locator('.workflow-run-status')).toHaveText(
        runs.map(({ status }) => status),
      );
      if (name === '이슈 #1') {
        await expect(
          rows.nth(3).getByText('근거', { exact: true }),
        ).toBeVisible();
      }
      for (const [index, run] of runs.entries()) {
        const row = rows.nth(index);
        await expect(
          row.getByRole('link', { name: run.title }),
        ).toHaveAttribute('href', run.url);
        if (run.startedAt) {
          await expect(row.locator('time')).toHaveAttribute(
            'datetime',
            run.startedAt,
          );
        } else {
          await expect(row.getByText('—', { exact: true })).toBeVisible();
        }
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
  });

  test('좁은 PR 팝업은 CI 상태와 실행 목록을 캐릭터 없이 표시한다', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    const report = structuredClone(alphaReport);
    const forge = report.forges!.find(({ number }) => number === 12)!;
    forge.stage = 'ci';
    forge.quality = 'ci';
    forge.runs[0]!.status = 'in_progress';
    forge.runs.push(
      ...Array.from({ length: 9 }, (_, index) => ({
        title: `이전 CI ${index + 1}`,
        url: `https://github.com/${alpha}/actions/runs/${300 + index}`,
        status: 'success',
      })),
    );
    await seedSettings(page, [alpha]);
    await mockGitHub(page);
    await page.route('**/api/github?**', (route) =>
      new URL(route.request().url()).searchParams.has('branches')
        ? route.fulfill({ json: report })
        : route.fallback(),
    );
    await page.goto('/');
    await page.getByRole('button', { name: /PR #12/ }).click();
    const dialog = page.getByRole('dialog', { name: 'PR #12' });
    await expect(dialog.getByText('품질 시험', { exact: true })).toHaveCount(0);
    await expect(dialog.locator('.badge img')).toHaveCount(0);
    const list = dialog.getByRole('list', { name: 'GitHub Actions 실행 목록' });
    const rows = list.getByRole('listitem');
    await expect(rows).toHaveCount(10);
    const row = rows.filter({ hasText: 'in_progress' });
    await expect(row.getByRole('link', { name: 'CI' })).toBeVisible();
    expect(
      await row.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await expectWorkflowRunRows(rows);

    const lastLink = rows.last().getByRole('link', { name: '이전 CI 9' });
    await expect(lastLink).not.toBeInViewport();
    await list.hover();
    await page.mouse.wheel(0, 800);
    await expect
      .poll(() => list.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    await expect(lastLink).toBeInViewport({ ratio: 1 });
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

  for (const mode of ['world', 'simple'] as const) {
    for (const length of ['짧은', '긴'] as const) {
      test(`이슈 제목: ${mode} 모드에서 ${length} 제목을 본문 왼쪽에 정렬한다`, async ({
        page,
      }) => {
        const report = structuredClone(alphaReport);
        const quest = report.quests.find(({ number }) => number === 1)!;
        quest.reason = '지도 개편 작업을 진행하고 있습니다.';
        quest.title =
          length === '긴'
            ? `✨ Map layout regression: ${'WideIdentifier'.repeat(14)}`
            : `✨ ${quest.title}`;
        await mockGitHub(page);
        await seedSettings(page, [alpha], mode);
        await page.route('**/api/github?**', (route) => {
          const params = new URL(route.request().url()).searchParams;
          return params.get('repo') === alpha && params.has('branches')
            ? route.fulfill({ json: report })
            : route.fallback();
        });
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto('/');
        await settled(page);
        await page.getByRole('button', { name: /^이슈 #1 / }).click();
        const dialog = page.getByRole('dialog', { name: '이슈 #1' });
        const heading = dialog.getByRole('heading', {
          level: 3,
          name: quest.title,
          exact: true,
        });
        await expect(heading).toBeVisible();

        for (const viewport of [
          { width: 1280, height: 800 },
          { width: 320, height: 720 },
        ]) {
          await page.setViewportSize(viewport);
          await expect(heading).toHaveCSS('text-align', 'left');
          const geometry = await heading.evaluate((node) => {
            const body = node.closest('.dialog-body')!;
            const popup = node.closest('dialog')!.getBoundingClientRect();
            const reason = body.querySelector('.reason')!;
            const content = reason.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(node);
            return {
              popup: { left: popup.left, right: popup.right },
              content: { left: content.left, right: content.right },
              bodyWidth: body.clientWidth,
              bodyScrollWidth: body.scrollWidth,
              lines: Array.from(range.getClientRects(), ({ left, right }) => ({
                left,
                right,
              })),
            };
          });
          await test.info().attach(`issue-title-${viewport.width}px`, {
            body: JSON.stringify({ viewport, ...geometry }, null, 2),
            contentType: 'application/json',
          });

          const { popup, content, lines, bodyWidth, bodyScrollWidth } =
            geometry;
          expect(popup.left).toBeGreaterThanOrEqual(0);
          expect(popup.right).toBeLessThanOrEqual(viewport.width);
          expect(bodyScrollWidth).toBeLessThanOrEqual(bodyWidth);
          const leftInset = content.left - popup.left;
          const rightInset = popup.right - content.right;
          expect(leftInset).toBeGreaterThan(0);
          expect(rightInset).toBeGreaterThan(0);
          expect(Math.abs(leftInset - rightInset)).toBeLessThan(1);
          if (length === '짧은') {
            expect(lines).toHaveLength(1);
          } else {
            expect(lines.length).toBeGreaterThan(1);
          }
          for (const line of lines) {
            expect(Math.abs(line.left - content.left)).toBeLessThan(1);
            expect(line.right).toBeLessThanOrEqual(content.right + 1);
          }
        }

        await expect(
          dialog.getByRole('link', { name: '이슈 #1', exact: true }),
        ).toHaveAttribute('href', quest.url);
        await dialog.getByRole('button', { name: '이슈 댓글 4개' }).click();
        await expect(
          dialog.getByText('지도 개편 범위를 정리했습니다.'),
        ).toBeVisible();
        await dialog.getByRole('button', { name: '닫기' }).click();
        await expect(dialog).toBeHidden();
      });
    }
  }

  test('몬스터: 상태와 활동 집계를 먼저 보여 주고 선택한 기록만 조회한다', async ({
    page,
  }) => {
    const github = await openWorld(page);
    await page.getByRole('button', { name: /^이슈 #1 / }).click();
    const dialog = page.getByRole('dialog', { name: '이슈 #1' });

    const counters = dialog.getByRole('group', { name: '이슈 활동' });
    const headingColor = await dialog
      .locator('.dialog-heading')
      .evaluate((node) => getComputedStyle(node).color);
    for (const name of [
      '고유 커밋 3개',
      '이슈 댓글 4개',
      'PR 댓글 2개',
      '리뷰 1개',
    ]) {
      const counter = counters.getByRole('button', { name, exact: true });
      await expect(counter).toBeVisible();
      await expect(counter).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(counter).toHaveCSS('color', headingColor);
      await expect(counter.locator('svg')).toHaveCSS('stroke', headingColor);
      await expect(counter).toHaveAttribute('aria-expanded', 'false');
    }
    expect(github.count('activity')).toBe(0);
    const title = dialog.getByRole('link', { name: '이슈 #1', exact: true });
    await expect(title).toHaveAttribute('href', /issues\/1$/);
    await expect(title.locator('svg')).toHaveCount(0);
    await expect(
      dialog.getByRole('heading', { name: '모험가 파티' }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole('link', { name: /PR #11 · ✨ 지도: 새 시설 추가/ }),
    ).toBeVisible();
    const issueComments = counters.getByRole('button', {
      name: '이슈 댓글 4개',
    });
    await issueComments.focus();
    await expect(issueComments).toBeFocused();
    await issueComments.press('Enter');
    await expect(issueComments).toHaveAttribute('aria-expanded', 'true');
    await expect(issueComments).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );
    await expect(dialog.locator('.activity-entry')).toHaveCount(2);
    const issueComment = dialog.getByText('지도 개편 범위를 정리했습니다.');
    await expect(issueComment).toBeVisible();
    await expect(dialog.getByText('시설 배치부터 진행합니다.')).toBeVisible();

    const commits = counters.getByRole('button', { name: '고유 커밋 3개' });
    const commitLink = dialog.getByRole('link', { name: 'a1b2c3d' });
    await commits.click();
    await expect(commits).toHaveAttribute('aria-expanded', 'true');
    await expect(issueComments).toHaveAttribute('aria-expanded', 'false');
    await expect(issueComment).toBeHidden();
    await expect(commitLink).toBeVisible();
    await commits.click();
    await expect(commits).toHaveAttribute('aria-expanded', 'false');
    await expect(commitLink).toBeHidden();
    await commits.click();
    await expect(commitLink).toBeVisible();

    const reviews = counters.getByRole('button', { name: '리뷰 1개' });
    await reviews.click();
    await expect(reviews).toHaveAttribute('aria-expanded', 'true');
    await expect(commits).toHaveAttribute('aria-expanded', 'false');
    await expect(commitLink).toBeHidden();
    await expect(dialog.getByText('배치 계산을 확인했습니다.')).toBeVisible();

    expect(github.queries('activity')).toEqual([
      { repo: alpha, activity: 'comments', number: '1', page: '1' },
      { repo: alpha, activity: 'commits', number: '11', page: '1' },
      { repo: alpha, activity: 'reviews', number: '11', page: '1' },
    ]);
    // 집계가 응답에 다 있었으므로 창을 열 때 집계 요청은 없었습니다.
    expect(github.count('summary')).toBe(0);

    await dialog.getByRole('button', { name: '닫기' }).click();
    await expect(dialog).toBeHidden();
  });

  const issueUrl = (number: number) =>
    `https://github.com/${alpha}/issues/${number}`;
  const child = (
    number: number,
    state: string,
    stateReason?: string,
  ): SubIssue => ({
    number,
    title: `하위 작업 ${number}`,
    url: issueUrl(number),
    state,
    stateReason,
  });
  const done = [200, 201, 202, 203].map((number) =>
    child(number, 'closed', 'completed'),
  );
  const open = child(201, 'open');
  const notPlanned = child(202, 'closed', 'not_planned');
  const unknown = child(203, 'closed', nullReason());

  function nullReason() {
    return undefined;
  }

  const subIssueCases: {
    name: string;
    initial: SubIssueList;
    remaining?: SubIssueList;
    heading?: string;
    statuses: string[];
    mobile?: boolean;
    mode?: 'world' | 'simple';
  }[] = [
    {
      name: '#199의 완료된 자식 네 개를 모두 연결한다',
      initial: { items: done },
      heading: '서브 이슈 · 4/4 완료',
      statuses: ['완료', '완료', '완료', '완료'],
      mobile: true,
    },
    {
      name: '간단 모드에서 #199의 완료된 자식 네 개를 모두 연결한다',
      initial: { items: done },
      heading: '서브 이슈 · 4/4 완료',
      statuses: ['완료', '완료', '완료', '완료'],
      mobile: true,
      mode: 'simple',
    },
    {
      name: '팝업을 열 때 나머지를 조회하고 종료 사유를 구분한다',
      initial: { items: [done[0]!], nextPage: 2 },
      remaining: { items: [open, notPlanned, unknown] },
      heading: '서브 이슈 · 1/4 완료',
      statuses: ['완료', '열림', '계획 없음', '닫힘 · 종료 사유 미확인'],
    },
    {
      name: '자식이 없는 것으로 확인되면 섹션을 생략한다',
      initial: { items: [] },
      statuses: [],
    },
    {
      name: '부분 조회에서는 기존 링크와 새로 확보한 링크를 유지한다',
      initial: { items: [done[0]!], nextPage: 2 },
      remaining: { items: [open], nextPage: 3 },
      heading: '서브 이슈',
      statuses: ['완료', '열림'],
    },
  ];

  for (const fixture of subIssueCases) {
    test(`서브 이슈: ${fixture.name}`, async ({ page }) => {
      await mockGitHub(page);
      const mode = fixture.mode ?? 'world';
      await seedSettings(page, [alpha], mode);
      const report = structuredClone(alphaReport);
      const parent = report.quests.find(({ number }) => number === 1)!;
      const items = [
        ...fixture.initial.items,
        ...(fixture.remaining?.items ?? []),
      ];
      report.quests = [
        {
          ...parent,
          number: 199,
          url: issueUrl(199),
          subIssueCount: fixture.remaining?.nextPage ? 4 : items.length,
          subIssues: fixture.initial,
        },
      ];
      const lookups: Record<string, string>[] = [];
      await page.route('**/api/github?**', async (route) => {
        const params = new URL(route.request().url()).searchParams;
        if (params.get('repo') !== alpha) return route.fallback();
        if (params.has('subIssues')) {
          lookups.push(Object.fromEntries(params));
          return route.fulfill({
            json: fixture.remaining ?? { items: [], nextPage: 1 },
          });
        }
        if (
          ['summary', 'activity', 'heritage', 'repository', 'reviews'].some(
            (key) => params.has(key),
          )
        )
          return route.fallback();
        await route.fulfill({ json: report });
      });

      await page.goto('/');
      await settled(page);
      await expect(
        page.getByRole('button', { name: '간단 모드' }),
      ).toHaveAttribute('aria-pressed', String(mode === 'simple'));
      expect(lookups).toEqual([]);
      await page.getByRole('button', { name: /^이슈 #199 / }).click();
      const dialog = page.getByRole('dialog', { name: '이슈 #199' });
      await expect(dialog).toBeVisible();
      const section = dialog.getByRole('region', { name: '서브 이슈' });
      if (fixture.heading) {
        if (fixture.mobile)
          await page.setViewportSize({ width: 390, height: 844 });
        await expect(
          section.getByRole('heading', { name: fixture.heading, exact: true }),
        ).toBeVisible();
        if (fixture.remaining?.nextPage)
          await expect(section.getByRole('status')).toHaveText(
            '서브 이슈를 일부만 확인했습니다.',
          );
        await expect(section.getByRole('link')).toHaveCount(items.length);
        for (const [index, item] of items.entries()) {
          const link = section.getByRole('link', {
            name: new RegExp(`#${item.number} · ${item.title}$`),
          });
          await expect(link).toHaveAttribute('href', item.url);
          await expect(
            link.getByRole('img', {
              name: fixture.statuses[index],
              exact: true,
            }),
          ).toBeVisible();
          if (fixture.mobile) await link.click({ trial: true });
        }
      } else {
        await expect(section).toHaveCount(0);
      }
      expect(lookups).toEqual(
        fixture.remaining ? [{ repo: alpha, subIssues: '199', page: '2' }] : [],
      );
    });
  }

  test('몬스터: PR별로 기록을 열고 근거와 실행 링크를 중복 표시하지 않는다', async ({
    page,
  }) => {
    const github = await mockGitHub(page);
    await seedSettings(page, [alpha]);
    const report = structuredClone(alphaReport);
    const issue = report.quests.find((item) => item.number === 1)!;
    const failedIssue = report.quests.find((item) => item.number === 2)!;
    const repoUrl = `https://github.com/${alpha}`;
    const comment = {
      title: '개입 근거 댓글',
      body: 'PR #12에서 확인한 변경 사항입니다.',
      url: `${repoUrl}/pull/12#issuecomment-120`,
    };
    issue.stage = 'attention';
    issue.evidence = { title: comment.title, url: comment.url };
    issue.adventurers = [
      { agent: 'codex', roles: ['develop'], active: 'develop' },
      { agent: 'claude', roles: ['review'] },
    ];
    issue.pulls = [
      { ...issue.pulls[0]!, activities: { comments: 1 } },
      {
        number: 12,
        title: '후속 변경',
        url: `${repoUrl}/pull/12`,
        activities: { comments: 1 },
      },
    ];
    issue.runs = [];

    const failedRun = {
      title: '실패한 CI · 전체 실행 이름이 좁은 화면에서 말줄임되는 긴 작업',
      url: `${repoUrl}/actions/runs/201`,
      status: 'failure',
      startedAt: '2026-01-15T01:00:00Z',
    };
    const previousRun = {
      title: '이전 CI',
      url: `${repoUrl}/actions/runs/200`,
      status: 'success',
    };
    failedIssue.evidence = failedRun;
    failedIssue.runs = [
      failedRun,
      previousRun,
      ...[
        'queued',
        'in_progress',
        'cancelled',
        'skipped',
        'future_status',
        'action_required',
        'stale',
        'success',
      ].map((status, index) => ({
        title: `실행 ${index + 1}`,
        url: `${repoUrl}/actions/runs/${199 - index}`,
        status,
      })),
    ];

    const sourceQueries: Record<string, string>[] = [];
    await page.route('**/api/github?**', async (route) => {
      const params = new URL(route.request().url()).searchParams;
      if (params.has('branches')) {
        await route.fulfill({ json: report });
      } else if (
        params.get('activity') === 'comments' &&
        params.get('number') === '12'
      ) {
        sourceQueries.push(Object.fromEntries(params));
        await route.fulfill({ json: { entries: [comment] } });
      } else {
        await route.fallback();
      }
    });
    await page.goto('/');
    await settled(page);

    await page.getByRole('button', { name: /^이슈 #1 / }).click();
    const dialog = page.getByRole('dialog', { name: '이슈 #1' });
    await expect(dialog.getByRole('img', { name: '개입 필요' })).toHaveCount(0);
    const rpgStatus = /모험가 전투|모험가 검토|출정 준비|재전투/;
    await expect(dialog.getByText(rpgStatus)).toHaveCount(0);
    await expect(dialog.getByTitle(rpgStatus)).toHaveCount(0);
    await expect(dialog.getByRole('img', { name: rpgStatus })).toHaveCount(0);
    for (const name of ['Codex', 'Claude']) {
      const adventurer = dialog.getByRole('img', { name, exact: true });
      await expect(adventurer).toHaveCount(0);
    }

    const evidence = dialog.locator(`a[href="${comment.url}"]`);
    await expect(evidence).toBeVisible();
    await expect(
      dialog.getByText('GitHub Actions', { exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole('button', { name: 'PR 댓글 2개' }).click();
    await expect(
      dialog.getByText('PR #11 · 댓글', { exact: true }),
    ).toBeVisible();
    const secondSource = dialog.getByText('PR #12 · 댓글', { exact: true });
    await expect(secondSource).toBeVisible();
    expect(github.count('activity')).toBe(0);
    expect(sourceQueries).toEqual([]);

    await secondSource.click();
    const body = dialog.getByText(comment.body, { exact: true });
    await expect(body).toBeVisible();
    await expect(dialog.getByText('위에 표시된 근거 기록')).toBeVisible();
    await expect(evidence).toHaveCount(1);
    await secondSource.click();
    await expect(body).toBeHidden();
    await secondSource.click();
    await expect(body).toBeVisible();
    expect(github.count('activity')).toBe(0);
    expect(sourceQueries).toEqual([
      { repo: alpha, activity: 'comments', number: '12', page: '1' },
    ]);
    await dialog.getByRole('button', { name: '닫기' }).click();
    await expect(dialog).toBeHidden();

    await page.setViewportSize({ width: 320, height: 640 });
    await page.getByRole('button', { name: /^이슈 #2 / }).click();
    const failed = page.getByRole('dialog', { name: '이슈 #2' });
    await expect(failed.getByText('품질 시험이 실패했습니다.')).toBeVisible();
    const actions = failed.getByRole('region', { name: 'GitHub Actions' });
    const list = actions.getByRole('list', {
      name: 'GitHub Actions 실행 목록',
    });
    const rows = list.getByRole('listitem');
    const failedLink = failed.locator(`a[href="${failedRun.url}"]`);
    const previousLink = list.getByRole('link', { name: previousRun.title });
    await expect(actions.locator('summary, button')).toHaveCount(0);
    await expect(list).toBeVisible();
    await expect(rows).toHaveCount(10);
    await expect(failedLink).toBeVisible();
    await expect(failedLink).toHaveCount(1);
    await expect(failedLink).toHaveAccessibleName(failedRun.title);
    await expect(failedLink).toHaveAttribute('title', failedRun.title);
    const runName = failedLink.locator('span');
    await expect(runName).toHaveCSS('text-overflow', 'ellipsis');
    expect(
      await runName.evaluate((node) => node.scrollWidth > node.clientWidth),
    ).toBe(true);
    const failedRow = rows.filter({ hasText: failedRun.title });
    await expect(failedRow.getByText('근거', { exact: true })).toBeVisible();
    await expect(previousLink).toBeVisible();
    await expect(previousLink).toHaveAttribute('href', previousRun.url);
    await expect(rows.nth(1).getByText('—', { exact: true })).toBeVisible();
    const startedAt = failedRow.locator('time');
    await expect(startedAt).toHaveAttribute('datetime', failedRun.startedAt);
    await expect(startedAt).toHaveText(/2026.*1.*15.*10:00 KST/);
    const badges = list.locator('.workflow-run-status');
    await expect(badges).toHaveText([
      'failure',
      'success',
      'queued',
      'in_progress',
      'cancelled',
      'skipped',
      'future_status',
      'action_required',
      'stale',
      'success',
    ]);
    const badgeColors = [
      ['rgb(80, 38, 53)', 'rgb(255, 206, 215)'],
      ['rgb(26, 64, 43)', 'rgb(192, 241, 210)'],
      ['rgb(75, 56, 18)', 'rgb(255, 226, 160)'],
      ['rgb(23, 57, 84)', 'rgb(197, 231, 255)'],
      ['rgb(66, 52, 81)', 'rgb(234, 216, 255)'],
      ['rgb(45, 59, 66)', 'rgb(216, 228, 233)'],
      ['rgb(54, 50, 65)', 'rgb(236, 230, 244)'],
      ['rgb(75, 56, 18)', 'rgb(255, 226, 160)'],
      ['rgb(80, 38, 53)', 'rgb(255, 206, 215)'],
    ];
    for (const [index, [background, foreground]] of badgeColors.entries()) {
      await expect(badges.nth(index)).toHaveCSS('background-color', background);
      await expect(badges.nth(index)).toHaveCSS('color', foreground);
    }
    await expectWorkflowRunRows(rows);

    await expect(startedAt).toBeInViewport({ ratio: 1 });
    await expect(
      failedRow.getByText('failure', { exact: true }),
    ).toBeInViewport({ ratio: 1 });
    expect(await list.evaluate((node) => node.scrollWidth)).toBe(
      await list.evaluate((node) => node.clientWidth),
    );
    const lastRow = rows.last();
    const lastLink = lastRow.getByRole('link', { name: '실행 8', exact: true });
    await expect(lastLink).not.toBeInViewport();
    await list.hover();
    await page.mouse.wheel(0, 800);
    await expect
      .poll(() => list.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    await expect(lastLink).toBeInViewport({ ratio: 1 });
    await expect(lastRow.getByText('—', { exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expect(lastRow.getByText('success', { exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expect(lastLink).toHaveAttribute(
      'href',
      `${repoUrl}/actions/runs/192`,
    );
  });

  for (const status of ['reviewing', 'recovering']) {
    test(`몬스터: 자동화 단계 ${status}와 실행 상태를 각각 표시한다`, async ({
      page,
    }) => {
      await mockGitHub(page);
      await seedSettings(page, [alpha]);
      const report = structuredClone(alphaReport);
      const issue = report.quests.find((item) => item.number === 1)!;
      const repoUrl = `https://github.com/${alpha}`;
      issue.evidence = {
        title: 'GitHub Actions 상태 기록',
        url: `${repoUrl}/issues/1#issuecomment-120`,
        status,
      };
      issue.runs = [
        {
          title: 'CI',
          url: `${repoUrl}/actions/runs/201`,
          status: 'success',
        },
      ];
      issue.activity = { ...issue.activity!, issueComments: 0 };
      await page.route('**/api/github?**', async (route) => {
        if (new URL(route.request().url()).searchParams.has('branches')) {
          await route.fulfill({ json: report });
        } else {
          await route.fallback();
        }
      });
      await page.goto('/');
      await settled(page);
      await page.getByRole('button', { name: /^이슈 #1 / }).click();

      const dialog = page.getByRole('dialog', { name: '이슈 #1' });
      const evidence = dialog.getByRole('link', {
        name: new RegExp(`GitHub Actions 상태 기록.*${status}`),
      });
      await expect(evidence).toHaveAttribute('href', issue.evidence.url);
      const stage = evidence.locator('.workflow-run-status');
      await expect(stage).toHaveText(status);
      await expect(stage).toHaveCSS('background-color', 'rgb(23, 57, 84)');
      await expect(stage).toHaveCSS('color', 'rgb(197, 231, 255)');
      const runStatus = dialog
        .getByRole('region', { name: 'GitHub Actions' })
        .locator('.workflow-run-status');
      await expect(runStatus).toHaveText('success');
      await expect(runStatus).toHaveCSS('background-color', 'rgb(26, 64, 43)');

      const counter = dialog.getByRole('img', { name: '이슈 댓글 0개' });
      const headingColor = await dialog
        .locator('.dialog-heading')
        .evaluate((node) => getComputedStyle(node).color);
      await expect(counter).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(counter).toHaveCSS('color', headingColor);
      await expect(counter.locator('svg')).toHaveCSS('stroke', headingColor);
    });
  }

  test('몬스터: 실패한 이슈는 사유를 보여 주고, 없는 집계는 이슈로 조회한다', async ({
    page,
  }) => {
    const github = await openWorld(page);
    await page.getByRole('button', { name: /^이슈 #2 / }).click();
    const dialog = page.getByRole('dialog', { name: '이슈 #2' });

    await expect(dialog.getByText('품질 시험이 실패했습니다.')).toBeVisible();
    await expect(dialog.getByRole('img', { name: '실행 실패' })).toHaveCount(0);
    // 이슈 집계(댓글 6개)가 활동량에 반영됩니다. PR 집계 값(5)이면 실패합니다.
    await expect(
      dialog
        .getByRole('group', { name: '이슈 활동' })
        .locator('.activity-counter'),
    ).toHaveText(['0', '6', '0', '0']);
    expect(github.queries('summary')).toEqual([
      { repo: alpha, summary: 'issue', number: '2', counts: 'comments' },
    ]);
  });

  test('몬스터: 연결 PR의 고유 커밋을 동시 요청 한도 안에서 집계한다', async ({
    page,
  }) => {
    const github = await mockGitHub(page);
    await seedSettings(page, [alpha]);
    await page.addInitScript(() => {
      const fetch = window.fetch;
      let started = 0;
      window.fetch = (input, options) => {
        if (String(input).includes('summary=')) {
          document.documentElement.dataset.summaryRequests = String(++started);
        }
        return fetch(input, options);
      };
    });

    const report = structuredClone(alphaReport);
    const issue = report.quests.find(({ number }) => number === 2)!;
    issue.activity = { pullComments: 0, reviews: 1 };
    const forges = report.forges;
    if (!forges || forges.length < 3) {
      throw new Error('alphaReport에 PR 픽스처가 3개 이상 필요합니다.');
    }
    issue.pulls = forges
      .slice(0, 3)
      .map(({ number, title, url }) => ({ number, title, url }));
    const replies: Record<string, object> = {
      '2': { comments: 0 },
      '11': { commits: 2, shas: ['a', 'b'] },
      '12': { commits: 3, shas: ['b', 'c'] },
      '13': { commits: 1, shas: ['d'] },
    };
    const queries = [
      { repo: alpha, summary: 'issue', number: '2', counts: 'comments' },
      ...issue.pulls.map(({ number }) => ({
        repo: alpha,
        summary: 'pull',
        number: String(number),
        counts: 'shas',
      })),
    ];
    const calls: Record<string, string>[] = [];
    const sortedCalls = () =>
      [...calls].sort((a, b) => Number(a.number) - Number(b.number));
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/github?**', async (route) => {
      const params = new URL(route.request().url()).searchParams;
      if (params.has('branches') && params.get('repo') === alpha) {
        return route.fulfill({ json: report });
      }
      if (!params.has('summary')) return route.fallback();
      calls.push(Object.fromEntries(params));
      await held;
      await route.fulfill({
        json: {
          ...replies[params.get('number') ?? ''],
          people: [],
          complete: false,
        },
      });
    });
    await page.goto('/');
    await settled(page);
    const counters = page
      .getByRole('dialog', { name: '이슈 #2' })
      .getByRole('group', { name: '이슈 활동' });
    try {
      await page.getByRole('button', { name: /^이슈 #2 / }).click();
      await expect.poll(sortedCalls).toEqual(queries.slice(0, 3));
      await expect(page.locator('html')).toHaveAttribute(
        'data-summary-requests',
        '3',
      );
      await expect(
        counters.getByRole('button', { name: '이슈 댓글 미확인' }),
      ).toHaveText('—');
    } finally {
      release();
    }
    await expect(
      counters.getByRole('button', { name: '고유 커밋 4개 이상' }),
    ).toHaveText('4+');
    await expect(counters.locator('.activity-counter')).toHaveText([
      '4+',
      '0',
      '0',
      '1',
    ]);
    expect(sortedCalls()).toEqual(queries);
    expect(github.count('activity')).toBe(0);
  });

  test('몬스터: 별도 성공은 실패 표시를 지우지 않고 재개 기록은 지운다', async ({
    page,
  }) => {
    const at = '2026-11-22T01:00:00Z';
    const issueUrl = `https://github.com/${alpha}/issues/78`;
    const title = '개발 자동화 상태 확인';
    const reason = 'Codex reached the output token limit.';
    const run = (id: number, overrides: Partial<Run> = {}): Run => ({
      id,
      run_attempt: 1,
      path: '.github/workflows/ai-development.yml',
      name: 'AI development',
      display_title: 'AI development for Issue #78',
      status: 'completed',
      conclusion: 'failure',
      html_url: `https://github.com/${alpha}/actions/runs/${id}`,
      head_sha: 'a'.repeat(40),
      head_branch: 'dev',
      event: 'issues',
      created_at: at,
      updated_at: at,
      run_started_at: at,
      pull_requests: [],
      ...overrides,
    });
    const failed = run(45528330850);
    const successful = run(45528331272, {
      conclusion: 'success',
      run_started_at: '2026-11-22T01:01:00Z',
    });
    const retry = run(successful.id + 1, {
      status: 'in_progress',
      conclusion: null,
      run_started_at: '2026-11-22T01:02:00Z',
    });
    const checkpoint = (
      id: number,
      state: Record<string, unknown>,
    ): Comment => ({
      body: `<!-- alpha-ai-state:${Buffer.from(
        JSON.stringify({ issue: 78, developer: 'codex', ...state }),
      ).toString('base64')} -->`,
      user: { login: 'github-actions[bot]' },
      issue_url: `https://api.github.com/repos/${alpha}/issues/78`,
      html_url: `${issueUrl}#issuecomment-${id}`,
      updated_at: at,
    });
    const failure = checkpoint(1, { status: 'failed', run: failed.id, reason });
    const recovery = checkpoint(2, { status: 'developing', runId: retry.id });
    let resumed = false;
    await mockGitHub(page);
    await seedSettings(page, [alpha]);
    await page.route('**/api/github?**', async (route) => {
      if (!new URL(route.request().url()).searchParams.has('branches')) {
        await route.fallback();
        return;
      }
      const quests = makeQuests(
        repositoryRegion(alpha),
        [{ number: 78, state: 'open', title, html_url: issueUrl, labels: [] }],
        [],
        resumed ? [retry, successful, failed] : [successful, failed],
        resumed ? [recovery, failure] : [failure],
        new Map(),
        [],
      );
      await route.fulfill({ json: { ...alphaReport, quests } });
    });
    await page.goto('/');
    await settled(page);

    const marker = page.getByRole('button', { name: /^이슈 #78 / });
    await expect(marker).toBeVisible();
    await expect(marker).toHaveAccessibleName(/실행 실패/);
    await expect(marker).toHaveClass(/(?:^|\s)blocked(?:\s|$)/);
    await marker.click();
    const dialog = page.getByRole('dialog', { name: '이슈 #78' });
    await expect(dialog.getByRole('img', { name: '실행 실패' })).toHaveCount(0);
    await expect(dialog.getByText(reason)).toBeVisible();
    const actions = dialog.getByRole('region', { name: 'GitHub Actions' });
    await expect(actions.locator('.workflow-run-status')).toHaveText([
      'success',
      'failure',
    ]);
    const failureRow = actions.getByRole('listitem').filter({
      has: page.getByText('failure', { exact: true }),
    });
    await expect(failureRow.getByText('근거', { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole('link', { name: /GitHub Actions 상태 기록/ }),
    ).toHaveCount(0);
    await dialog.getByRole('button', { name: '닫기' }).click();

    resumed = true;
    await page.getByRole('button', { name: '새로 고침' }).click();
    await settled(page);
    await expect(marker).toHaveAccessibleName(/개발 중/);
    await expect(marker).not.toHaveAccessibleName(/실행 실패/);
    await expect(marker).not.toHaveClass(/(?:^|\s)blocked(?:\s|$)/);
    await marker.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img', { name: '실행 실패' })).toHaveCount(0);
    await expect(dialog.getByText(reason)).toHaveCount(0);
    const recoveryEvidence = dialog.getByRole('link', {
      name: /GitHub Actions 상태 기록.*developing/,
    });
    await expect(recoveryEvidence).toHaveAttribute('href', recovery.html_url);
    await expect(recoveryEvidence.locator('.workflow-run-status')).toHaveText(
      'developing',
    );
    await expect(actions.locator('.workflow-run-status')).toHaveText([
      'in_progress',
      'success',
      'failure',
    ]);
  });

  test('개발 광장: 작업 중인 시설과 작업 이력을 나눠 보여 준다', async ({
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
    await expect(
      current.getByRole('button', { name: /PR #12/ }).locator('.badge.failed'),
    ).toBeVisible();

    const history = dialog.getByRole('region', { name: '작업 이력' });
    await expect(
      history.getByRole('heading', { name: '작업 이력', exact: true }),
    ).toBeVisible();
    // 이력은 끝난 시각이 최근인 순서입니다.
    await expect(history.getByRole('button').first()).toBeVisible();
    await expect(history.locator('.quest-row small')).toHaveText([
      'PR #9',
      'PR #8',
    ]);

    await dialog.getByRole('button', { name: /PR #13/ }).click();
    await expect(page.getByRole('dialog', { name: 'PR #13' })).toBeVisible();
  });

  test('좁은 광장에서 긴 작업 이력 끝까지 스크롤할 수 있다', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await mockGitHub(page);
    await seedSettings(page, [alpha]);
    const report = structuredClone(alphaReport);
    const facility = report.forges!.find((pull) => pull.merged)!;
    report.forges = Array.from({ length: 20 }, (_, index) => ({
      ...facility,
      number: 100 + index,
    }));
    await page.route('**/api/github?**', async (route) => {
      if (new URL(route.request().url()).searchParams.has('branches'))
        await route.fulfill({ json: report });
      else await route.fallback();
    });
    await page.goto('/');
    await settled(page);
    await page.getByRole('button', { name: '개발 광장 · dev' }).click();
    const dialog = page.getByRole('dialog', { name: '개발 광장' });
    await expect(dialog.getByText('조회된 PR이 없습니다.')).toBeVisible();
    const list = dialog
      .getByRole('region', { name: '작업 이력' })
      .getByRole('list');
    await list.getByRole('button').last().scrollIntoViewIfNeeded();
    await expect
      .poll(() => list.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    await list.getByRole('button').last().click();
    await expect(page.getByRole('dialog', { name: 'PR #119' })).toBeVisible();
  });

  test('왕궁: 저장소 제목 링크에 키보드로 접근할 수 있다', async ({ page }) => {
    await openWorld(page);
    await page.getByTitle('왕궁 · main').click();
    const dialog = page.getByRole('dialog', { name: alpha });
    const heading = dialog.getByRole('heading', { name: alpha, exact: true });
    const link = heading.getByRole('link', { name: alpha, exact: true });
    const remove = dialog.getByRole('button', { name: '월드맵에서 제거' });
    const close = dialog.getByRole('button', { name: '닫기' });

    await expect(link).toHaveAttribute('href', `https://github.com/${alpha}`);
    await expect(heading.locator('svg')).toHaveCount(0);
    await expect(
      dialog.getByLabel('저장소로 이동', { exact: true }),
    ).toHaveCount(0);
    await expect(remove).toBeVisible();
    await expect(close).toBeVisible();

    await expect(link).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(remove).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(link).toBeFocused();
  });

  test('왕궁: 배포 기록을 최신 순으로 10개씩 보여 준다', async ({ page }) => {
    await openWorld(page);
    await page.getByTitle('왕궁 · main').click();
    const dialog = page.getByRole('dialog', { name: alpha });
    const rows = dialog.locator('.release-row');

    await expect(
      dialog.getByRole('heading', { name: '배포 기록 (KST)', exact: true }),
    ).toBeVisible();
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

    await expect(
      dialog.getByText('feature/facility', { exact: true }),
    ).toHaveCount(1);
    await expect(dialog.getByText('관측된 PR 대상 · dev')).toBeVisible();
    const link = dialog.getByRole('link', { name: /PR #11 · dev/ });
    await expect(link).toContainText('열림');
    await expect(link).toHaveAttribute(
      'href',
      `https://github.com/${alpha}/pull/11`,
    );
  });
});
