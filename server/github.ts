import { makeQuests, pullIssue, regions, runIssue, runStage } from './model.ts';
import type {
  Comment,
  Issue,
  Pull,
  Region,
  Release,
  Report,
  Run,
  Source,
  Stage,
} from './model.ts';

const publicReportTtl = 60_000;
const manualRefreshCooldown = 15_000;
const publicReports = new Map<
  string,
  { requestedAt: number; pending: boolean; value: Promise<Report> }
>();
let publicRateLimit: { until: number; error: GitHubError } | undefined;

class GitHubError extends Error {
  status: number;

  constructor(status: number) {
    super(`GitHub API · HTTP ${status}`);
    this.status = status;
  }
}

function client(region: Region, token?: string) {
  const root = `https://api.github.com/repos/han41858/${region.id}`;
  return async function get<T>(path: string): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Agentopia/0.1',
    };
    if (token) headers.Authorization = token;
    const response = await fetch(root + path, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) {
      const error = new GitHubError(response.status);
      if (!token && (response.status === 429 || response.status === 403)) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const reset =
          response.headers.get('x-ratelimit-remaining') === '0'
            ? Number(response.headers.get('x-ratelimit-reset')) * 1000
            : 0;
        const now = Date.now();
        const until = Math.max(
          reset,
          retryAfter > 0 ? now + retryAfter * 1000 : 0,
          response.status === 429 ? now + publicReportTtl : 0,
        );
        if (until > now && until > (publicRateLimit?.until ?? 0))
          publicRateLimit = { until, error };
      }
      throw error;
    }
    return response.json() as Promise<T>;
  };
}

type Deployment = { id: number; environment: string; sha: string };
type DeploymentStatus = { state: string; description?: string };
type Job = Pick<Run, 'name' | 'status' | 'conclusion' | 'html_url'>;
const releaseStages: Record<string, Stage> = {
  queued: 'queued',
  pending: 'queued',
  in_progress: 'deploying',
  success: 'complete',
  error: 'failed',
  failure: 'failed',
};
const recent = '?per_page=50';

async function getReport(region: Region, token?: string): Promise<Report> {
  const get = client(region, token);
  const warnings = new Set<string>();
  async function optional<T>(label: string, load: Promise<T>, fallback: T) {
    try {
      return await load;
    } catch {
      warnings.add(label);
      return fallback;
    }
  }

  const [issuePage, pulls, workflow, comments, deployments] = await Promise.all(
    [
      get<Issue[]>(`/issues${recent}&state=all&sort=updated&direction=desc`),
      optional(
        'PR',
        get<Pull[]>(`/pulls${recent}&state=all&sort=updated&direction=desc`),
        [],
      ),
      optional(
        'Actions',
        get<{ workflow_runs: Run[] }>('/actions/runs?per_page=100'),
        { workflow_runs: [] },
      ),
      optional(
        'AI 상태 기록',
        get<Comment[]>(
          '/issues/comments?per_page=100&sort=updated&direction=desc',
        ),
        [],
      ),
      optional('배포', get<Deployment[]>('/deployments?per_page=5'), []),
    ],
  );
  const runs = workflow.workflow_runs.sort((a, b) => b.id - a.id);
  const issues = new Map(
    issuePage
      .filter((issue) => !issue.pull_request)
      .map((issue) => [issue.number, issue]),
  );
  const linked = [
    ...new Set([
      ...runs.map(runIssue),
      ...pulls.map((pull) => pullIssue(pull, region)),
    ]),
  ];
  const missing = linked.filter(
    (number): number is number => number !== undefined && !issues.has(number),
  );
  const parentCandidates = [...issues.values()].filter(
    (issue) => issue.sub_issues_summary?.total,
  );
  if (missing.length > 12) warnings.add('이전 연결 Issue 일부');
  if (parentCandidates.length > 8) warnings.add('하위 Issue 일부');

  const parents = new Map<number, number>();
  const subIssueTasks = parentCandidates.slice(0, 8).map(async (parent) => {
    const children = await optional(
      '하위 Issue',
      get<Issue[]>(`/issues/${parent.number}/sub_issues?per_page=100`),
      [],
    );
    if ((parent.sub_issues_summary?.total ?? 0) > children.length)
      warnings.add('하위 Issue 일부');
    for (const child of children) {
      if (
        !child.html_url.startsWith(
          `https://github.com/han41858/${region.id}/issues/`,
        )
      ) {
        warnings.add('다른 저장소의 하위 Issue');
        continue;
      }
      parents.set(child.number, parent.number);
      if (!issues.has(child.number)) issues.set(child.number, child);
    }
  });
  const issueTasks = missing.slice(0, 12).map(async (number) => {
    const issue = await optional(
      '연결 Issue',
      get<Issue | null>(`/issues/${number}`),
      null,
    );
    if (issue && !issue.pull_request) issues.set(issue.number, issue);
  });
  const deploymentTasks = deployments.map(
    async (deployment): Promise<Release | undefined> => {
      const statuses = await optional(
        '배포 상태',
        get<DeploymentStatus[]>(
          `/deployments/${deployment.id}/statuses?per_page=1`,
        ),
        [],
      );
      const status = statuses[0];
      if (!status || !Object.hasOwn(releaseStages, status.state)) return;
      return {
        title: deployment.environment,
        url: `https://github.com/han41858/${region.id}/deployments`,
        status: status.description
          ? `${status.state} · ${status.description}`
          : status.state,
        sha: deployment.sha,
        stage: releaseStages[status.state],
      };
    },
  );
  const publishTasks =
    region.id === 'videx'
      ? runs
          .filter(
            (run) =>
              run.path.split('@')[0] ===
                '.github/workflows/windows-tauri.yml' &&
              run.head_branch === 'main' &&
              run.event !== 'pull_request',
          )
          .slice(0, 2)
          .map(async (run): Promise<Release | undefined> => {
            const result = await optional(
              'Windows 릴리스',
              get<{ jobs: Job[] }>(
                `/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=50`,
              ),
              { jobs: [] },
            );
            const publish = result.jobs.find(
              ({ name }) => name === 'Publish GitHub release',
            );
            if (!publish || publish.conclusion === 'skipped') return;
            const outcome = runStage(publish);
            return {
              title: publish.name,
              url: publish.html_url,
              status: publish.conclusion ?? publish.status,
              stage: outcome === 'developing' ? 'deploying' : outcome,
              sha: run.head_sha,
            };
          })
      : [];
  const [, , repoDeployments, publishJobs] = await Promise.all([
    Promise.all(subIssueTasks),
    Promise.all(issueTasks),
    Promise.all(deploymentTasks),
    Promise.all(publishTasks),
  ]);
  const releaseRuns = runs.filter(
    (run) =>
      run.path.split('@')[0] === '.github/workflows/production-release.yml' ||
      run.path.split('@')[0] === '.github/workflows/release.yml',
  );
  const releases: Release[] = [...repoDeployments, ...publishJobs].filter(
    (entry) => entry !== undefined,
  );
  // Recovery workflows execute against the automation ref. Only deployment records identify a deployed commit.
  for (const run of releaseRuns.slice(0, 5)) {
    const outcome = runStage(run);
    const stage = outcome === 'developing' ? 'deploying' : outcome;
    releases.push({
      title: run.name,
      url: run.html_url,
      status: run.conclusion ?? run.status,
      stage,
    });
  }
  const quests = makeQuests(
    region,
    [...issues.values()],
    pulls,
    runs,
    comments,
    parents,
    releases,
  );
  return {
    quests,
    releases: releases.map(({ title, url, status, stage }) => ({
      title,
      url,
      status,
      stage,
    })),
    updatedAt: new Date().toISOString(),
    warnings: [...warnings].sort(),
  };
}

export function regionReport(region: Region, token?: string, force = false) {
  if (token) return getReport(region, token);
  const cached = publicReports.get(region.id);
  const now = Date.now();
  if (publicRateLimit && publicRateLimit.until > now) {
    if (!cached) throw publicRateLimit.error;
    return cached.value.then((report) => ({
      ...report,
      warnings: [...report.warnings, 'GitHub API 사용 한도'],
    }));
  }
  const maxAge = force ? manualRefreshCooldown : publicReportTtl;
  if (cached && (cached.pending || now - cached.requestedAt < maxAge))
    return cached.value;

  const entry = {
    requestedAt: now,
    pending: true,
    value: getReport(region),
  };
  publicReports.set(region.id, entry);
  void entry.value.then(
    () => {
      entry.pending = false;
    },
    () => {
      if (publicReports.get(region.id) !== entry) return;
      if (cached) publicReports.set(region.id, cached);
      else publicReports.delete(region.id);
    },
  );
  return entry.value;
}

async function pullReviews(
  region: Region,
  pull: string,
  token?: string,
): Promise<Source[]> {
  const get = client(region, token);
  const reviews = await get<
    { user?: { login: string }; state: string; html_url: string }[]
  >(`/pulls/${pull}/reviews?per_page=100`);
  return reviews.map((review) => ({
    title: review.user?.login ?? 'GitHub review',
    status: review.state,
    url: review.html_url,
  }));
}

export async function githubResponse(
  url: URL,
  method: string | undefined,
  authorization?: string,
) {
  const reply = (status: number, data: unknown) => ({
    status,
    body: JSON.stringify(data),
  });
  if (method !== 'GET') return reply(405, { error: 'GET 요청만 지원합니다.' });
  if (authorization && !/^Bearer [a-zA-Z0-9_]{1,512}$/.test(authorization)) {
    return reply(400, { error: 'GitHub 토큰 형식을 확인해 주세요.' });
  }
  const region = regions.find(
    ({ id }) => id === url.searchParams.get('region'),
  );
  if (!region) return reply(400, { error: '지원하는 저장소를 선택해 주세요.' });
  const pull = url.searchParams.get('reviews');
  if (pull !== null && !/^[1-9]\d{0,11}$/.test(pull))
    return reply(400, { error: 'PR 번호를 확인해 주세요.' });

  try {
    const result =
      pull === null
        ? await regionReport(
            region,
            authorization,
            url.searchParams.get('refresh') === '1',
          )
        : await pullReviews(region, pull, authorization);
    return reply(200, result);
  } catch (error) {
    if (error instanceof GitHubError) {
      const message =
        {
          401: 'GitHub 인증에 실패했습니다. 읽기 전용 토큰을 확인해 주세요.',
          403: 'GitHub에서 요청을 거부했습니다. 권한 또는 API 사용 한도를 확인해 주세요.',
          404: '저장소 또는 PR을 찾을 수 없습니다. 비공개 저장소라면 읽기 전용 토큰이 필요합니다.',
          429: 'GitHub API 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
        }[error.status] ?? error.message;
      return reply(error.status >= 500 ? 502 : error.status, {
        error: message,
      });
    }
    return reply(502, { error: 'GitHub API에 연결할 수 없습니다.' });
  }
}
