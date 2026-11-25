import { repositoryOwner, repositoryRegion, repositorySlug } from './model.ts';
import { GitHubError } from './github-client.ts';
import { listRepositories, repositoryInfo } from './github-repositories.ts';
import { regionReport, readBranches } from './github-report.ts';
import {
  pullReviews,
  activityPage,
  activitySummary,
} from './github-activity.ts';
import type { ActivitySummaryField } from './github-activity.ts';
import { repositoryHeritage } from './github-heritage.ts';

import { withRefreshCache } from './refresh-cache.ts';

export async function githubResponse(
  url: URL,
  method: string | undefined,
  authorization?: string,
  ticket?: string,
) {
  const reply = (status: number, data: unknown) => ({
    status,
    body: JSON.stringify(data),
  });
  const cacheReport =
    ticket !== undefined &&
    Boolean(authorization) &&
    url.searchParams.get('measure') === 'refresh' &&
    [...url.searchParams.keys()].every((key) =>
      ['repo', 'measure', 'branches', 'refresh', 'history'].includes(key),
    );
  if (method !== 'GET' && !(method === 'POST' && cacheReport))
    return reply(405, { error: 'GET 요청만 지원합니다.' });
  if (authorization && !/^Bearer [a-zA-Z0-9_]{1,512}$/.test(authorization)) {
    return reply(400, { error: 'GitHub 토큰 형식을 확인해 주세요.' });
  }
  try {
    const ownerInput = url.searchParams.get('owner');
    if (ownerInput !== null) {
      const owner = repositoryOwner(ownerInput);
      const cursor = url.searchParams.get('cursor');
      const cursorPattern = authorization
        ? /^[a-z\d_+=/-]{1,256}$/i
        : /^[1-9]\d{0,5}$/;
      if (!owner || (cursor !== null && !cursorPattern.test(cursor)))
        return reply(400, { error: 'GitHub 계정 이름을 확인해 주세요.' });
      return reply(200, await listRepositories(owner, cursor, authorization));
    }
    const slug = repositorySlug(url.searchParams.get('repo') ?? '');
    if (!slug) return reply(400, { error: '지원하는 저장소를 선택해 주세요.' });
    const region = repositoryRegion(slug);
    if (url.searchParams.get('heritage') === '1')
      return reply(200, await repositoryHeritage(region, authorization));
    const summary = url.searchParams.get('summary');
    if (summary !== null) {
      const number = url.searchParams.get('number') ?? '';
      if (
        (summary !== 'issue' && summary !== 'pull') ||
        !/^[1-9]\d{0,11}$/.test(number)
      )
        return reply(400, { error: '조회할 GitHub 활동을 확인해 주세요.' });
      const requested = url.searchParams.get('counts')?.split(',');
      const fields = requested?.filter(
        (field): field is ActivitySummaryField =>
          field === 'comments' ||
          (summary === 'pull' &&
            (field === 'commits' || field === 'shas' || field === 'reviews')),
      );
      if (fields?.length !== requested?.length)
        return reply(400, { error: '조회할 GitHub 활동을 확인해 주세요.' });
      return reply(
        200,
        await activitySummary(region, summary, number, authorization, fields),
      );
    }
    const activity = url.searchParams.get('activity');
    if (activity !== null) {
      const number = url.searchParams.get('number') ?? '';
      const page = url.searchParams.get('page') ?? '1';
      if (
        (activity !== 'commits' &&
          activity !== 'comments' &&
          activity !== 'reviews') ||
        !/^[1-9]\d{0,11}$/.test(number) ||
        !/^[1-9]\d{0,3}$/.test(page)
      )
        return reply(400, { error: '조회할 GitHub 활동을 확인해 주세요.' });
      return reply(
        200,
        await activityPage(
          region,
          activity,
          number,
          Number(page),
          authorization,
        ),
      );
    }
    const pull = url.searchParams.get('reviews');
    if (pull !== null && !/^[1-9]\d{0,11}$/.test(pull))
      return reply(400, { error: 'PR 번호를 확인해 주세요.' });
    if (url.searchParams.get('repository') === '1')
      return reply(200, await repositoryInfo(region, authorization));
    if (pull !== null)
      return reply(200, await pullReviews(region, pull, authorization));
    const force = url.searchParams.get('refresh') === '1';
    const loadReport = () =>
      Promise.all([
        regionReport(
          region,
          authorization,
          force,
          url.searchParams.get('history') !== 'cached',
        ),
        url.searchParams.get('branches') === '1'
          ? readBranches(region, authorization, force).catch(() => undefined)
          : undefined,
      ]);
    const {
      result: [result, branchInventory],
      refreshTicket,
    } =
      cacheReport && authorization
        ? await withRefreshCache(slug, authorization, ticket ?? '', loadReport)
        : { result: await loadReport(), refreshTicket: undefined };
    return reply(200, { ...result, branchInventory, refreshTicket });
  } catch (error) {
    if (error instanceof GitHubError) {
      if (error.rateLimited)
        return reply(error.status, {
          error: 'GitHub API 사용 한도에 도달했습니다.',
          rateLimited: true,
        });
      const message =
        {
          401: 'GitHub 인증에 실패했습니다. 읽기 전용 토큰을 확인해 주세요.',
          403: 'GitHub에서 요청을 거부했습니다. 저장소와 토큰 권한을 확인해 주세요.',
          404: url.searchParams.has('owner')
            ? 'GitHub 계정을 찾을 수 없습니다.'
            : '저장소 또는 PR을 찾을 수 없습니다. 비공개 저장소라면 읽기 전용 토큰이 필요합니다.',
          429: 'GitHub API 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
        }[error.status] ?? error.message;
      return reply(error.status >= 500 ? 502 : error.status, {
        error: message,
      });
    }
    return reply(502, { error: 'GitHub API에 연결할 수 없습니다.' });
  }
}
