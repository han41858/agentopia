import {
  linkedPullIssues,
  makePullQuests,
  makeQuests,
  pullActor,
  regions,
  repositoryOwner,
  repositoryRegion,
  repositorySlug,
  runIssue,
  runStage,
} from './model.ts';
import type {
  Comment,
  Issue,
  Pull,
  PullLinks,
  Region,
  Release,
  Repository,
  RepositoryPage,
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

function client(region?: Region, token?: string) {
  const root = region
    ? `https://api.github.com/repos/${region.slug}`
    : 'https://api.github.com';
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
const pageSize = 50;
const recent = `?per_page=${pageSize}`;

async function githubGraphql<T>(
  query: string,
  variables: Record<string, string | null>,
  token: string,
) {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      'User-Agent': 'Agentopia/0.1',
    },
    body: JSON.stringify({ query, variables }),
    redirect: 'error',
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new GitHubError(response.status);
  const body = (await response.json()) as {
    errors?: { type?: string }[];
    data?: T;
  };
  if (body.errors?.length)
    throw new GitHubError(
      body.errors.some(({ type }) => type === 'NOT_FOUND') ? 404 : 403,
    );
  if (!body.data) throw new GitHubError(502);
  return body.data;
}

type ListedRepository = { slug: string; private: boolean; visibility?: string };

function ownerRepositories(owner: string, nodes: ListedRepository[]) {
  return nodes.flatMap((node) => {
    const slug = repositorySlug(node.slug);
    return slug?.startsWith(`${owner}/`)
      ? [
          {
            slug,
            private:
              node.private ||
              (node.visibility !== undefined &&
                node.visibility.toLowerCase() !== 'public'),
          },
        ]
      : [];
  });
}

async function listRepositories(
  owner: string,
  cursor: string | null,
  token?: string,
): Promise<RepositoryPage> {
  if (token) {
    const data = await githubGraphql<{
      repositoryOwner: {
        repositories: {
          nodes: {
            nameWithOwner: string;
            isPrivate: boolean;
            visibility: string;
          }[];
          pageInfo: { hasNextPage: boolean; endCursor: string };
        };
      } | null;
    }>(
      `query($owner: String!, $cursor: String) {
        repositoryOwner(login: $owner) {
          repositories(first: 50, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes { nameWithOwner isPrivate visibility }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { owner, cursor },
      token,
    );
    const result = data.repositoryOwner?.repositories;
    if (!result) throw new GitHubError(404);
    return {
      repositories: ownerRepositories(
        owner,
        result.nodes.map((node) => ({
          slug: node.nameWithOwner,
          private: node.isPrivate,
          visibility: node.visibility,
        })),
      ),
      next: result.pageInfo.hasNextPage ? result.pageInfo.endCursor : undefined,
    };
  }

  const page = Number(cursor ?? 1);
  const get = client();
  const results = await get<
    { full_name: string; private: boolean; visibility?: string }[]
  >(`/users/${owner}/repos?type=owner&sort=updated&direction=desc&per_page=50&page=${page}`);
  return {
    repositories: ownerRepositories(
      owner,
      results.map((item) => ({
        slug: item.full_name,
        private: item.private,
        visibility: item.visibility,
      })),
    ).filter((repo) => !repo.private),
    next: results.length === 50 ? String(page + 1) : undefined,
  };
}

type NativePull = {
  number: number;
  closingIssuesReferences: {
    nodes: { number: number; repository: { nameWithOwner: string } }[];
  };
  latestReviews: {
    nodes: {
      author: { login: string; __typename: string } | null;
      state: string;
      submittedAt: string | null;
      commit: { oid: string } | null;
    }[];
  };
};

async function nativePullLinks(region: Region, token: string, pulls: Pull[]) {
  const [owner, name] = region.slug.split('/');
  const query = `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        pullRequests(first: 50, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes {
            number
            closingIssuesReferences(first: 20) { nodes { number repository { nameWithOwner } } }
            latestReviews(first: 10) { nodes { author { login __typename } state submittedAt commit { oid } } }
          }
        }
      }
    }`;
  const data = await githubGraphql<{
    repository?: { pullRequests: { nodes: NativePull[] } };
  }>(query, { owner, name }, token);
  const nodes = data.repository?.pullRequests.nodes;
  if (!nodes) throw new GitHubError(404);

  const headByNumber = new Map(
    pulls.map((pull) => [pull.number, pull.head.sha]),
  );
  const links = new Map<number, PullLinks>();
  for (const pull of nodes) {
    const issues = pull.closingIssuesReferences.nodes
      .filter(
        (issue) => issue.repository.nameWithOwner.toLowerCase() === region.slug,
      )
      .map(({ number }) => number);
    const latest = pull.latestReviews.nodes
      .filter(
        (review) =>
          review.submittedAt &&
          review.state !== 'DISMISSED' &&
          review.commit?.oid === headByNumber.get(pull.number),
      )
      .sort((a, b) =>
        (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''),
      )[0];
    const reviewer = pullActor(
      latest?.author?.login,
      latest?.author?.__typename,
    );
    links.set(pull.number, {
      issues,
      reviewer,
      review: reviewer ? latest.state : undefined,
    });
  }
  return links;
}

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

  const [issuePage, pullPage, workflow, comments, deployments] =
    await Promise.all([
      get<Issue[]>(
        `/issues${recent}&state=all&sort=updated&direction=desc`,
      ).catch((error) => {
        if (!(error instanceof GitHubError) || error.status !== 410)
          throw error;
        warnings.add('이슈 비활성화');
        return [];
      }),
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
    ]);
  const runs = workflow.workflow_runs.sort((a, b) => b.id - a.id);
  const issues = new Map(
    issuePage
      .filter((issue) => !issue.pull_request)
      .map((issue) => [issue.number, issue]),
  );
  const pulls = [...pullPage];
  if (pullPage.length === pageSize) {
    const seen = new Set(pullPage.map(({ number }) => number));
    const open = await optional(
      '열린 PR',
      get<Pull[]>(`/pulls${recent}&state=open&sort=updated&direction=desc`),
      [],
    );
    pulls.push(...open.filter(({ number }) => !seen.has(number)));
    pulls.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  const pullLinks =
    token && pulls.some(({ state }) => state === 'open')
      ? await optional(
          'PR 이슈 연결 및 리뷰',
          nativePullLinks(region, token, pulls),
          new Map<number, PullLinks>(),
        )
      : new Map<number, PullLinks>();
  const linked = [
    ...new Set([
      ...runs.map(runIssue),
      ...pulls.flatMap((pull) =>
        linkedPullIssues(pull, region, pullLinks.get(pull.number)),
      ),
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
        !child.html_url
          .toLowerCase()
          .startsWith(`https://github.com/${region.slug}/issues/`)
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
        url: `https://github.com/${region.slug}/deployments`,
        status: status.description
          ? `${status.state} · ${status.description}`
          : status.state,
        sha: deployment.sha,
        stage: releaseStages[status.state],
      };
    },
  );
  const publishTasks =
    region.slug === 'han41858/videx'
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
    pullLinks,
  );
  return {
    quests,
    pullQuests: makePullQuests(
      region,
      pulls,
      runs,
      new Set(issues.keys()),
      pullLinks,
    ),
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
  const cached = publicReports.get(region.slug);
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
  if (!cached && publicReports.size >= 32) {
    const oldest = publicReports.keys().next().value;
    if (oldest !== undefined) publicReports.delete(oldest);
  }
  publicReports.set(region.slug, entry);
  void entry.value.then(
    () => {
      entry.pending = false;
    },
    () => {
      if (publicReports.get(region.slug) !== entry) return;
      if (cached) publicReports.set(region.slug, cached);
      else publicReports.delete(region.slug);
    },
  );
  return entry.value;
}

async function repositoryInfo(
  region: Region,
  token?: string,
): Promise<Repository> {
  const get = client(region, token);
  const metadata = await get<{
    full_name: string;
    private: boolean;
    visibility?: string;
    has_issues?: boolean;
  }>('');
  const slug = repositorySlug(metadata.full_name);
  if (!slug || typeof metadata.private !== 'boolean')
    throw new GitHubError(502);
  const restricted =
    metadata.private ||
    (metadata.visibility !== undefined && metadata.visibility !== 'public');
  if (restricted && !token) throw new GitHubError(404);
  if (restricted && metadata.has_issues !== false)
    await get('/issues?per_page=1');
  return { slug, private: restricted };
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
    const repo = url.searchParams.get('repo');
    const slug = repo === null ? undefined : repositorySlug(repo);
    const region =
      repo === null
        ? regions.find(({ id }) => id === url.searchParams.get('region'))
        : slug && repositoryRegion(slug);
    if (!region)
      return reply(400, { error: '지원하는 저장소를 선택해 주세요.' });
    const pull = url.searchParams.get('reviews');
    if (pull !== null && !/^[1-9]\d{0,11}$/.test(pull))
      return reply(400, { error: 'PR 번호를 확인해 주세요.' });
    if (url.searchParams.get('repository') === '1')
      return reply(200, await repositoryInfo(region, authorization));
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
