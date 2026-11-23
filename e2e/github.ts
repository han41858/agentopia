import type { Page, Route } from '@playwright/test';
import {
  added,
  alpha,
  alphaHeritage,
  alphaReport,
  commitPage,
  denied,
  deniedMessage,
  empty,
  emptyReport,
  noPlaza,
  noPlazaReport,
  ownerPage,
  pullSummary,
} from './fixtures.ts';

export type Call = {
  // 요청 종류. report는 왕국 갱신 요청입니다.
  kind:
    | 'report'
    | 'heritage'
    | 'repository'
    | 'owner'
    | 'summary'
    | 'activity'
    | 'unknown';
  repo: string;
  params: URLSearchParams;
  authorization?: string;
};

type Reply = { status?: number; body: unknown };

const reports: Record<string, Reply> = {
  [alpha]: { body: alphaReport },
  [added]: { body: emptyReport },
  [noPlaza]: { body: noPlazaReport },
  [empty]: { body: emptyReport },
  [denied]: { status: 403, body: { error: deniedMessage } },
};

function classify(params: URLSearchParams): Call['kind'] {
  if (params.has('owner')) return 'owner';
  if (params.has('heritage')) return 'heritage';
  if (params.has('summary')) return 'summary';
  if (params.has('activity')) return 'activity';
  if (params.has('repository')) return 'repository';
  if (params.has('repo')) return 'report';
  return 'unknown';
}

function reply(kind: Call['kind'], repo: string): Reply {
  const known = reports[repo];
  switch (kind) {
    case 'report':
      return known ?? { status: 404, body: { error: '없는 저장소' } };
    case 'heritage':
      return repo === alpha ? { body: alphaHeritage } : { body: {} };
    case 'repository':
      return known && known.status === undefined
        ? { body: { slug: repo, private: false } }
        : (known ?? { status: 404, body: { error: '없는 저장소' } });
    case 'owner':
      return { body: ownerPage };
    case 'summary':
      return { body: pullSummary };
    case 'activity':
      return { body: commitPage };
    default:
      return { status: 400, body: { error: '알 수 없는 요청' } };
  }
}

/**
 * `/api/github` 요청을 모두 고정 응답으로 바꾸고, 받은 요청을 기록합니다.
 * 실제 GitHub에는 요청이 나가지 않습니다.
 */
export async function mockGitHub(
  page: Page,
  options: {
    // 응답을 보내기 전에 기다릴 조건. 로딩 상태 확인에 씁니다.
    hold?: (call: Call) => Promise<void> | undefined;
  } = {},
) {
  const calls: Call[] = [];
  await page.route('**/api/github?**', async (route: Route) => {
    const params = new URL(route.request().url()).searchParams;
    const call: Call = {
      kind: classify(params),
      repo: params.get('repo') ?? '',
      params,
      authorization: route.request().headers().authorization,
    };
    calls.push(call);
    await options.hold?.(call);
    const { status = 200, body } = reply(call.kind, call.repo);
    await route.fulfill({
      status,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(body),
    });
  });
  return {
    calls,
    count: (kind: Call['kind'], repo?: string) =>
      calls.filter(
        (call) =>
          call.kind === kind && (repo === undefined || call.repo === repo),
      ).length,
  };
}

/** 앱이 읽는 저장소 목록과 표시 모드를 첫 로드 전에 넣습니다. */
export async function seedSettings(
  page: Page,
  repositories: string[],
  mode?: 'world' | 'simple',
) {
  await page.addInitScript(
    ({ repositories, mode }) => {
      // 새로 고침 뒤에는 앱이 저장한 값을 그대로 씁니다.
      if (localStorage.getItem('agentopia.github-settings')) return;
      localStorage.setItem(
        'agentopia.github-settings',
        JSON.stringify({
          version: 2,
          token: '',
          repositories: repositories.map((slug) => ({ slug, private: false })),
        }),
      );
      if (mode) localStorage.setItem('agentopia.display-mode', mode);
    },
    { repositories, mode },
  );
}

/** 왕국 갱신이 끝나 지도가 멈춘 상태까지 기다립니다. */
export async function settled(page: Page) {
  await page.locator('.refresh-button[aria-busy="false"]').waitFor();
}

export async function openWorld(
  page: Page,
  repositories: string[] = [alpha],
  mode?: 'world' | 'simple',
) {
  const github = await mockGitHub(page);
  await seedSettings(page, repositories, mode);
  await page.goto('/');
  await settled(page);
  return github;
}
