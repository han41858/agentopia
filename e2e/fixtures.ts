import type { Heritage } from '../server/heritage.ts';
import type {
  ActivityPage,
  PullQuest,
  Quest,
  Report,
  RepositoryPage,
} from '../server/model.ts';
import type { Discussion, PullActivity } from '../server/activity.ts';

// 화면 테스트가 쓰는 고정 응답입니다. 타입을 서버 모델에 맞춰 두어
// 모델이 바뀌면 `npm run build`의 타입 검사에서 먼저 드러납니다.

export const owner = 'han41858';
export const alpha = `${owner}/alpha`;
export const noPlaza = `${owner}/noplaza`;
export const empty = `${owner}/empty`;
export const denied = `${owner}/denied`;
export const added = `${owner}/added`;

export const deniedMessage =
  'GitHub에서 요청을 거부했습니다. 저장소와 토큰 권한을 확인해 주세요.';

const pullUrl = (slug: string, number: number) =>
  `https://github.com/${slug}/pull/${number}`;
const issueUrl = (slug: string, number: number) =>
  `https://github.com/${slug}/issues/${number}`;

const alphaForges: PullQuest[] = [
  {
    number: 11,
    title: '✨ 지도: 새 시설 추가',
    url: pullUrl(alpha, 11),
    draft: false,
    stage: 'developing',
    author: 'codex',
    issues: [1],
    adventurers: [{ agent: 'codex', roles: ['develop'], active: 'develop' }],
    activity: {
      commits: 3,
      pullComments: 2,
      reviews: 1,
      participants: 2,
    },
    activities: { commits: 3, comments: 2, reviews: 1 },
    runs: [],
  },
  {
    number: 12,
    title: '🐛 도로: 경로 겹침 수정',
    url: pullUrl(alpha, 12),
    draft: false,
    stage: 'failed',
    issues: [2],
    adventurers: [{ agent: 'claude', roles: ['review'] }],
    runs: [
      {
        title: 'CI',
        url: `https://github.com/${alpha}/actions/runs/1`,
        status: 'failure',
        startedAt: '2026-01-15T01:00:00Z',
      },
    ],
  },
  {
    number: 13,
    title: '📝 문서: 개발 안내 보강',
    url: pullUrl(alpha, 13),
    draft: true,
    stage: 'idle',
    runs: [],
  },
  {
    number: 9,
    title: '♻️ 서버: 조회 코드 정리',
    url: pullUrl(alpha, 9),
    draft: false,
    merged: true,
    finishedAt: '2026-11-10T03:00:00Z',
    stage: 'complete',
    runs: [],
  },
  {
    number: 8,
    title: '🔥 에셋: 쓰지 않는 그림 삭제',
    url: pullUrl(alpha, 8),
    draft: false,
    cancelled: true,
    finishedAt: '2026-11-05T03:00:00Z',
    stage: 'idle',
    runs: [],
  },
];

const alphaQuests: Quest[] = [
  {
    number: 1,
    title: '상위 과제: 지도 개편',
    url: issueUrl(alpha, 1),
    stage: 'developing',
    state: 'open',
    subIssueCount: 2,
    developer: 'codex',
    workPull: 11,
    issueComments: 4,
    adventurers: [{ agent: 'codex', roles: ['develop'], active: 'develop' }],
    activity: {
      commits: 3,
      issueComments: 4,
      pullComments: 2,
      reviews: 1,
      participants: 2,
    },
    pulls: [
      {
        number: 11,
        title: '✨ 지도: 새 시설 추가',
        url: pullUrl(alpha, 11),
        status: 'open',
        activities: { commits: 3, comments: 2, reviews: 1 },
      },
    ],
    runs: [],
  },
  {
    number: 2,
    title: '하위 과제: 경로 겹침',
    url: issueUrl(alpha, 2),
    stage: 'failed',
    state: 'open',
    parent: 1,
    reason: '품질 시험이 실패했습니다.',
    pulls: [],
    runs: [],
  },
  {
    number: 3,
    title: '하위 과제: 안내 문서',
    url: issueUrl(alpha, 3),
    stage: 'idle',
    state: 'open',
    parent: 1,
    pulls: [],
    runs: [],
  },
  {
    number: 4,
    title: '독립 과제: 색상 점검',
    url: issueUrl(alpha, 4),
    stage: 'idle',
    state: 'open',
    released: true,
    pulls: [
      {
        number: 9,
        title: alphaForges[3].title,
        url: pullUrl(alpha, 9),
        status: 'merged',
      },
    ],
    runs: [],
  },
  {
    number: 5,
    title: '끝난 과제: 초기 구조',
    url: issueUrl(alpha, 5),
    stage: 'complete',
    state: 'closed',
    pulls: [],
    runs: [],
  },
];

// 게시된 릴리스 1개와 태그 12개. v1.3.0은 릴리스와 태그가 겹쳐 한 줄로 합쳐지므로
// 배포 기록은 12줄입니다(첫 화면 10줄 + 더 보기 2줄).
const alphaTags = Array.from({ length: 12 }, (_, index) => ({
  name: index === 0 ? 'v1.3.0' : `prod-${String(12 - index).padStart(2, '0')}`,
  committedAt: `2026-11-${String(21 - index).padStart(2, '0')}T02:30:00Z`,
}));

export const alphaReport: Report = {
  quests: alphaQuests,
  forges: alphaForges,
  branchInventory: {
    defaultBranch: 'dev',
    names: ['dev', 'docs/guide', 'feature/facility', 'fix/road', 'main'],
    partial: false,
  },
  branchPulls: [
    { number: 11, base: 'dev', head: 'feature/facility', merged: false },
    { number: 12, base: 'dev', head: 'fix/road', merged: false },
    { number: 13, base: 'dev', head: 'docs/guide', merged: false },
    { number: 9, base: 'dev', head: 'refactor/server', merged: true },
    { number: 7, base: 'main', head: 'dev', merged: true },
  ],
  tags: alphaTags,
  releases: [
    {
      title: 'v1.3.0',
      url: `https://github.com/${alpha}/releases/tag/v1.3.0`,
      status: '릴리스',
      stage: 'complete',
      at: '2026-11-22T01:00:00Z',
    },
  ],
  updatedAt: '2026-11-22T03:00:00Z',
  warnings: [],
};

export const alphaHeritage: Heritage = {
  mergedPulls: { count: 1234, source: 'search' },
  resolvedIssues: { count: 56, source: 'search' },
  reviews: { count: 7, source: 'github' },
  comments: { count: 0, source: 'github' },
};

export const noPlazaReport: Report = {
  quests: [
    {
      number: 31,
      title: '단일 브랜치 과제',
      url: issueUrl(noPlaza, 31),
      stage: 'idle',
      state: 'open',
      pulls: [],
      runs: [],
    },
  ],
  forges: [
    {
      number: 21,
      title: '⚡ 조회: 응답 재사용',
      url: pullUrl(noPlaza, 21),
      draft: false,
      stage: 'reviewing',
      runs: [],
    },
  ],
  branchInventory: {
    defaultBranch: 'main',
    names: ['main', 'perf/cache'],
    partial: false,
  },
  branchPulls: [
    { number: 21, base: 'main', head: 'perf/cache', merged: false },
  ],
  tags: [],
  releases: [],
  updatedAt: '2026-11-22T03:00:00Z',
  warnings: [],
};

export const emptyReport: Report = {
  quests: [],
  forges: [],
  branchInventory: { defaultBranch: 'main', names: ['main'], partial: false },
  branchPulls: [],
  tags: [],
  releases: [],
  updatedAt: '2026-11-22T03:00:00Z',
  warnings: [],
};

export const pullSummary: PullActivity = {
  shas: ['a1', 'b2'],
  commits: 2,
  comments: 5,
  reviews: 1,
  people: ['han41858', 'codex-bot'],
  complete: true,
};

export const commitPage: ActivityPage = {
  entries: [
    {
      title: 'a1b2c3d',
      url: `https://github.com/${alpha}/commit/a1b2c3d`,
      author: 'han41858',
      body: '시설 배치 계산 추가',
      at: '2026-11-21T00:00:00Z',
    },
    {
      title: 'd4e5f6a',
      url: `https://github.com/${alpha}/commit/d4e5f6a`,
      author: 'codex-bot',
      at: '2026-11-20T00:00:00Z',
    },
  ],
};

export const commentPage: ActivityPage = {
  entries: [
    {
      title: '댓글 1',
      url: `https://github.com/${alpha}/issues/1#issuecomment-1`,
      author: 'han41858',
      body: '지도 개편 범위를 정리했습니다.',
      at: '2026-11-19T00:00:00Z',
    },
    {
      title: '댓글 2',
      url: `https://github.com/${alpha}/issues/1#issuecomment-2`,
      author: 'codex-bot',
      body: '시설 배치부터 진행합니다.',
      at: '2026-11-19T01:00:00Z',
    },
  ],
};

export const reviewPage: ActivityPage = {
  entries: [
    {
      title: '리뷰 1',
      url: `https://github.com/${alpha}/pull/11#pullrequestreview-1`,
      author: 'claude-bot',
      body: '배치 계산을 확인했습니다.',
      status: '승인',
      at: '2026-11-21T02:00:00Z',
    },
  ],
};

export const issueSummary: Discussion = {
  comments: 6,
  people: ['han41858'],
  complete: true,
};

export const ownerPage: RepositoryPage = {
  repositories: [
    { slug: alpha, private: false },
    { slug: added, private: false },
    { slug: noPlaza, private: false },
  ],
};
