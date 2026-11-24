import { alpha, alphaReport } from './fixtures.ts';
import { mockGitHub, openWorld, seedSettings, settled } from './github.ts';
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
    await expect(dialog.getByRole('img', { name: '실행 실패' })).toBeVisible();
    await expect(dialog.getByRole('link', { name: /CI/ })).toBeVisible();
    expect(github.queries('summary')).toEqual([
      { repo: alpha, summary: 'pull', number: '12' },
    ]);
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
    await expect(rows.first().getByText('근거', { exact: true })).toBeVisible();
    await expect(previousLink).toBeVisible();
    await expect(previousLink).toHaveAttribute('href', previousRun.url);
    await expect(rows.nth(1).getByText('—', { exact: true })).toBeVisible();
    const startedAt = rows.first().locator('time');
    await expect(startedAt).toHaveAttribute('datetime', failedRun.startedAt);
    await expect(startedAt).toHaveText(/2026.*1.*15.*10:00 KST/);
    const badges = list.locator('.issue-action-status');
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
    for (const row of await rows.all()) {
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

    await expect(startedAt).toBeInViewport({ ratio: 1 });
    await expect(
      rows.first().getByText('failure', { exact: true }),
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
      const stage = evidence.locator('.issue-action-status');
      await expect(stage).toHaveText(status);
      await expect(stage).toHaveCSS('background-color', 'rgb(23, 57, 84)');
      await expect(stage).toHaveCSS('color', 'rgb(197, 231, 255)');
      const runStatus = dialog
        .getByRole('region', { name: 'GitHub Actions' })
        .locator('.issue-action-status');
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
    await expect(dialog.getByRole('img', { name: '실행 실패' })).toBeVisible();
    // 이슈 집계(댓글 6개)가 활동량에 반영됩니다. PR 집계 값(5)이면 실패합니다.
    await expect(
      dialog
        .getByRole('group', { name: '이슈 활동' })
        .locator('.activity-counter'),
    ).toHaveText(['0', '6', '0', '0']);
    expect(github.queries('summary')).toEqual([
      { repo: alpha, summary: 'issue', number: '2' },
    ]);
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
    await expect(
      dialog
        .getByRole('region', { name: '시설 이력' })
        .getByRole('button')
        .first(),
    ).toBeVisible();
    await expect(
      dialog.locator('.facility-history .quest-row small'),
    ).toHaveText(['PR #9', 'PR #8']);

    await dialog.getByRole('button', { name: /PR #13/ }).click();
    await expect(page.getByRole('dialog', { name: 'PR #13' })).toBeVisible();
  });

  test('좁은 광장에서 긴 시설 이력 끝까지 스크롤할 수 있다', async ({
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
      .getByRole('region', { name: '시설 이력' })
      .getByRole('list');
    await list.getByRole('button').last().scrollIntoViewIfNeeded();
    await expect
      .poll(() => list.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    await list.getByRole('button').last().click();
    await expect(page.getByRole('dialog', { name: 'PR #119' })).toBeVisible();
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
