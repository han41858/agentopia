import {
  githubDebugEnabled,
  githubDebugSnapshot,
  recordGitHubRequest,
} from './github-debug.ts';
import { onePerPageCount, verifiedCount } from './heritage.ts';
import type { Heritage, HeritageMetric } from './heritage.ts';
import { credentialScope, githubGet, observeGitHub } from './github-query.ts';
import { latestOpinion, reviewOpinion } from './activity.ts';
import type { Discussion, PullActivity } from './activity.ts';
import {
  linkedPullIssues,
  makeForges,
  makeQuests,
  pullActor,
  repositoryOwner,
  repositoryRegion,
  repositorySlug,
  runIssue,
  runStage,
} from './model.ts';
import type {
  ActivityEntry,
  ActivityKind,
  ActivityPage,
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
const publicReports = new Map<
  string,
  { requestedAt: number; pending: boolean; value: Promise<Report> }
>();
let publicRateLimit: { until: number; error: GitHubError } | undefined;

class GitHubError extends Error {
  status: number;
  readonly rateLimited: boolean;

  constructor(status: number, rateLimited = status === 429) {
    super(`GitHub API · HTTP ${status}`);
    this.status = status;
    this.rateLimited = rateLimited;
  }
}

function client(
  region?: Region,
  token?: string,
  force = false,
  scope = region?.slug ?? '(account)',
) {
  const root = region
    ? `https://api.github.com/repos/${region.slug}`
    : 'https://api.github.com';
  return async function get<T>(
    path: string,
    pagination?: (hasNext: boolean, link: string | null) => void,
    ttl = 0,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Agentopia/0.1',
    };
    if (token) headers.Authorization = token;
    const result = await githubGet(
      root + path,
      scope,
      token,
      headers,
      force ? 0 : ttl,
      async (response) => {
        if (response.ok) return;
        const retryAfter = Number(response.headers.get('retry-after'));
        const exhausted = response.headers.get('x-ratelimit-remaining') === '0';
        let rateLimited = response.status === 429;
        if (response.status === 403) {
          const payload = (await response.json().catch(() => undefined)) as
            { message?: string } | undefined;
          rateLimited =
            exhausted ||
            retryAfter > 0 ||
            /rate limit/i.test(payload?.message ?? '');
        }
        const error = new GitHubError(response.status, rateLimited);
        if (
          !token &&
          rateLimited &&
          !path.startsWith('/search/') &&
          (response.headers.get('x-ratelimit-resource') ?? 'core') === 'core'
        ) {
          const reset = exhausted
            ? Number(response.headers.get('x-ratelimit-reset')) * 1000
            : 0;
          const now = Date.now();
          const until = Math.max(
            reset,
            now + (retryAfter > 0 ? retryAfter * 1000 : publicReportTtl),
          );
          if (until > (publicRateLimit?.until ?? 0))
            publicRateLimit = { until, error };
        }
        throw error;
      },
    );
    pagination?.(result.next, result.link);
    return result.body as T;
  };
}

type Deployment = { id: number; environment: string; sha: string };
type DeploymentStatus = { state: string; description?: string };
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

const pendingGraphql = new Map<string, Promise<unknown>>();

async function githubGraphql<T>(
  query: string,
  variables: Record<string, string | null>,
  token: string,
  operation = variables.name ? 'pull-activity' : 'repositories',
) {
  const repo =
    variables.owner && variables.name
      ? `${variables.owner}/${variables.name}`
      : '(account)';
  const endpoint = `graphql/${operation}`;
  const key = JSON.stringify([credentialScope(token), query, variables]);
  const pending = pendingGraphql.get(key);
  if (pending) {
    observeGitHub(repo, endpoint, 'coalesced');
    return pending as Promise<T>;
  }
  const work = fetchGraphql<T>(query, variables, token, repo, endpoint);
  pendingGraphql.set(key, work);
  try {
    return await work;
  } finally {
    if (pendingGraphql.get(key) === work) pendingGraphql.delete(key);
  }
}

async function fetchGraphql<T>(
  query: string,
  variables: Record<string, string | null>,
  token: string,
  repo: string,
  endpoint: string,
) {
  observeGitHub(
    repo,
    endpoint,
    'request',
    undefined,
    Boolean(variables.cursor),
  );
  if (githubDebugEnabled()) recordGitHubRequest(credentialScope(token));
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
  observeGitHub(repo, endpoint, 'response', response.status);
  if (!response.ok) throw new GitHubError(response.status);
  const body = (await response.json()) as {
    errors?: { type?: string }[];
    data?: T;
  };
  if (body.errors?.length)
    throw new GitHubError(
      body.errors.some(({ type }) => type === 'NOT_FOUND') ? 404 : 403,
      body.errors.some(({ type }) => type === 'RATE_LIMITED'),
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
          repositories(first: 50, after: $cursor, isArchived: false, orderBy: {field: UPDATED_AT, direction: DESC}) {
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
    {
      full_name: string;
      private: boolean;
      visibility?: string;
      archived: boolean;
    }[]
  >(
    `/users/${owner}/repos?type=owner&sort=updated&direction=desc&per_page=50&page=${page}`,
  );
  return {
    repositories: ownerRepositories(
      owner,
      results
        .filter((item) => !item.archived)
        .map((item) => ({
          slug: item.full_name,
          private: item.private,
          visibility: item.visibility,
        })),
    ).filter((repo) => !repo.private),
    next: results.length === 50 ? String(page + 1) : undefined,
  };
}

type Login = { login: string };
type NativeDiscussion = {
  totalCount?: number;
  nodes?: { author: Login | null }[];
};
type NativeReview = {
  author: Login | null;
  state: string;
  submittedAt: string | null;
};

type NativePull = {
  number: number;
  author?: Login | null;
  commits?: { totalCount?: number; nodes?: { commit: { oid: string } }[] };
  comments?: NativeDiscussion;
  reviews?: NativeDiscussion;
  latestOpinionatedReviews?: { nodes: NativeReview[] };
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
  const candidates = pulls
    .filter(
      ({ number, state, merged_at }) =>
        Number.isSafeInteger(number) &&
        number > 0 &&
        (state === 'open' || merged_at),
    )
    .sort((left, right) => {
      const priority = (pull: Pull) =>
        Number(pull.state === 'open') * 2 +
        Number(linkedPullIssues(pull, region).length > 0);
      return priority(right) - priority(left);
    })
    .slice(0, 12);
  const samples = candidates
    .map(
      ({ number }) =>
        `sample${number}: pullRequest(number: ${number}) { ...ActivitySample }`,
    )
    .join(' ');
  const query = `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        pullRequests(first: 50, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes { ...PullActivity }
        }
        merged: pullRequests(first: 50, states: MERGED, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes { ...PullActivity }
        }
        ${samples}
        issues(first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes {
            number
            timelineItems(last: 1, itemTypes: [REOPENED_EVENT, CLOSED_EVENT]) { nodes { __typename } }
          }
        }
      }
    }
    fragment PullActivity on PullRequest {
      number
      author { login }
      commits { totalCount }
      comments { totalCount }
      reviews(states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) { totalCount }
      latestOpinionatedReviews(last: 10) { nodes { state submittedAt } }
      closingIssuesReferences(first: 20) { nodes { number repository { nameWithOwner } } }
      latestReviews(first: 10) { nodes { author { login __typename } state submittedAt commit { oid } } }
    }
    ${
      samples
        ? `fragment ActivitySample on PullRequest {
      commits(first: 35) { nodes { commit { oid } } }
      comments(last: 25) { nodes { author { login } } }
      reviews(last: 25, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) { nodes { author { login } } }
    }`
        : ''
    }`;
  const data = await githubGraphql<{
    repository?: Partial<
      Record<
        `sample${number}`,
        Partial<Pick<NativePull, 'commits' | 'comments' | 'reviews'>>
      >
    > & {
      pullRequests: { nodes: NativePull[] };
      merged?: { nodes: NativePull[] };
      issues?: {
        nodes: {
          number: number;
          timelineItems: { nodes: { __typename: string }[] };
        }[];
      };
    };
  }>(query, { owner, name }, token);
  if (!data.repository) throw new GitHubError(404);
  const nodes = [
    ...data.repository.pullRequests.nodes,
    ...(data.repository.merged?.nodes ?? []),
  ];

  const headByNumber = new Map(
    pulls.map((pull) => [pull.number, pull.head.sha]),
  );
  const links = new Map<number, PullLinks>();
  for (const pull of nodes) {
    if (!headByNumber.has(pull.number)) continue;
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
    const sample = data.repository[`sample${pull.number}`];
    const commenters = sample?.comments?.nodes ?? [];
    const reviewers = sample?.reviews?.nodes ?? [];
    const opinions = pull.latestOpinionatedReviews?.nodes ?? [];
    const activity: PullActivity = {
      shas: sample?.commits?.nodes?.map(({ commit }) => commit.oid) ?? [],
      commits: pull.commits?.totalCount,
      comments: pull.comments?.totalCount,
      reviews: pull.reviews?.totalCount,
      people: [
        pull.author?.login,
        ...[...commenters, ...reviewers].map(({ author }) => author?.login),
      ].filter((login): login is string => Boolean(login)),
      complete:
        pull.comments?.totalCount === commenters.length &&
        pull.reviews?.totalCount === reviewers.length,
      opinion: latestOpinion(
        opinions.flatMap(({ state, submittedAt }) => {
          const opinion = reviewOpinion(state, submittedAt);
          return opinion ? [opinion] : [];
        }),
      ),
    };
    links.set(pull.number, {
      issues,
      activity,
      activities: {
        commits: pull.commits?.totalCount,
        comments: pull.comments?.totalCount,
        reviews: pull.reviews?.totalCount,
      },
      reviewer,
      review: reviewer ? latest.state : undefined,
    });
  }
  const reopened = new Set(
    (data.repository.issues?.nodes ?? [])
      .filter(
        ({ timelineItems }) =>
          timelineItems.nodes[0]?.__typename === 'ReopenedEvent',
      )
      .map(({ number }) => number),
  );
  return { links, reopened };
}

async function publicCommitSample(pull: Pull, get: ReturnType<typeof client>) {
  let complete = false;
  const commits = await get<{ sha: string }[]>(
    `/pulls/${pull.number}/commits?per_page=35`,
    (next) => {
      complete = !next;
    },
    10 * 60_000,
  );
  return {
    shas: commits.map(({ sha }) => sha),
    commits: complete ? commits.length : undefined,
  };
}

async function getReport(
  region: Region,
  token?: string,
  force = false,
): Promise<Report> {
  const get = client(region, token, force);
  const warnings = new Set<string>();
  async function optional<T>(label: string, load: Promise<T>, fallback: T) {
    try {
      return await load;
    } catch {
      warnings.add(label);
      return fallback;
    }
  }

  const [issuePage, pullPage, workflow, deployments] = await Promise.all([
    get<Issue[]>(
      `/issues${recent}&state=all&sort=updated&direction=desc`,
    ).catch((error) => {
      if (!(error instanceof GitHubError) || error.status !== 410) throw error;
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
      '배포',
      get<Deployment[]>('/deployments?per_page=5', undefined, 45_000),
      [],
    ),
  ]);
  const runs = [...workflow.workflow_runs].sort((a, b) => b.id - a.id);
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
      get<Pull[]>(
        `/pulls${recent}&state=open&sort=updated&direction=desc`,
        undefined,
        45_000,
      ),
      [],
    );
    pulls.push(...open.filter(({ number }) => !seen.has(number)));
    pulls.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  const { links: pullLinks, reopened } =
    token && pulls.some(({ state, merged_at }) => state === 'open' || merged_at)
      ? await optional(
          'PR 이슈 연결 및 리뷰',
          nativePullLinks(region, token, pulls),
          { links: new Map<number, PullLinks>(), reopened: new Set<number>() },
        )
      : { links: new Map<number, PullLinks>(), reopened: new Set<number>() };
  if (!token) {
    const commentsByPull = new Map(
      issuePage
        .filter((issue) => issue.pull_request)
        .map((issue) => [issue.number, issue.comments]),
    );
    const samples = pulls
      .filter((pull) => pull.state === 'open' || pull.merged_at)
      .slice(0, 2);
    await Promise.all(
      samples.map(async (pull) => {
        const sample = await optional(
          'PR 커밋 일부',
          publicCommitSample(pull, get),
          undefined,
        );
        if (!sample) return;
        pullLinks.set(pull.number, {
          issues: [],
          activity: {
            ...sample,
            comments: commentsByPull.get(pull.number),
            people: [],
            complete: false,
          },
        });
      }),
    );
    for (const [number, count] of commentsByPull) {
      if (!pullLinks.has(number))
        pullLinks.set(number, {
          issues: [],
          activity: { shas: [], comments: count, people: [], complete: false },
        });
    }
  }
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
  const commentsTask =
    missing.length ||
    issuePage.some((issue) => issue.comments !== 0) ||
    runs.some((run) => runIssue(run) !== undefined)
      ? optional(
          'AI 상태 기록',
          get<Comment[]>(
            '/issues/comments?per_page=100&sort=updated&direction=desc',
          ),
          [],
        )
      : Promise.resolve([]);
  const parentCandidates = [...issues.values()].filter(
    (issue) => issue.sub_issues_summary?.total,
  );
  if (missing.length > 12) warnings.add('이전 연결 Issue 일부');
  if (parentCandidates.length > 8) warnings.add('하위 Issue 일부');

  const parents = new Map<number, number>();
  const subIssueTasks = parentCandidates.slice(0, 8).map(async (parent) => {
    const children = await optional(
      '하위 Issue',
      get<Issue[]>(
        `/issues/${parent.number}/sub_issues?per_page=100`,
        undefined,
        120_000,
      ),
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
      get<Issue | null>(`/issues/${number}`, undefined, 60_000),
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
          undefined,
          120_000,
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
  const [, , repoDeployments, comments] = await Promise.all([
    Promise.all(subIssueTasks),
    Promise.all(issueTasks),
    Promise.all(deploymentTasks),
    commentsTask,
  ]);
  const releaseRuns = runs.filter(
    (run) =>
      run.path.split('@')[0] === '.github/workflows/production-release.yml' ||
      run.path.split('@')[0] === '.github/workflows/release.yml',
  );
  const releases: Release[] = repoDeployments.filter(
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
  const forges = makeForges(region, pulls, runs, pullLinks, quests);
  return {
    quests: quests.map((quest) =>
      quest.state === 'open' && reopened.has(quest.number)
        ? { ...quest, reopened: true }
        : quest,
    ),
    forges,
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
  if (token) return getReport(region, token, force);
  const cached = publicReports.get(region.slug);
  const now = Date.now();
  if (publicRateLimit && publicRateLimit.until > now) {
    if (!cached) throw publicRateLimit.error;
    return cached.value.then((report) => ({
      ...report,
      warnings: [...report.warnings, 'GitHub API 사용 한도'],
    }));
  }
  if (
    cached &&
    (cached.pending || (!force && now - cached.requestedAt < publicReportTtl))
  ) {
    observeGitHub(
      region.slug,
      '(report)',
      cached.pending ? 'coalesced' : 'hit',
    );
    return cached.value;
  }

  const entry = {
    requestedAt: now,
    pending: true,
    value: getReport(region, undefined, force),
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

async function activityPage(
  region: Region,
  kind: ActivityKind,
  number: string,
  page: number,
  token?: string,
): Promise<ActivityPage> {
  const get = client(region, token);
  const query = `?per_page=30&page=${page}`;
  let entries: ActivityEntry[];
  let hasNext = false;
  const pagination = (next: boolean) => {
    hasNext = next;
  };
  if (kind === 'commits') {
    const result = await get<
      {
        sha: string;
        html_url: string;
        author?: { login: string } | null;
        commit: { message: string; author?: { date?: string; name?: string } };
      }[]
    >(`/pulls/${number}/commits${query}`, pagination, 30_000);
    entries = result.map((item) => ({
      title: item.sha.slice(0, 7),
      url: item.html_url,
      author: item.author?.login ?? item.commit.author?.name,
      body: item.commit.message,
      at: item.commit.author?.date,
    }));
  } else {
    const resource =
      kind === 'comments'
        ? `/issues/${number}/comments`
        : `/pulls/${number}/reviews`;
    const result = await get<
      {
        user?: { login: string } | null;
        state?: string;
        html_url: string;
        body?: string | null;
        created_at?: string;
        submitted_at?: string;
      }[]
    >(resource + query, pagination, 30_000);
    entries = result
      .filter((item) => kind !== 'reviews' || item.state !== 'PENDING')
      .map((item) => ({
        title: item.user?.login ?? 'GitHub',
        url: item.html_url,
        status: item.state,
        body: item.body?.replace(/<!--[\s\S]*?-->/g, '').trim() || undefined,
        at: item.submitted_at ?? item.created_at,
      }));
  }
  return { entries, next: hasNext ? page + 1 : undefined };
}

async function activitySummary(
  region: Region,
  scope: 'issue' | 'pull',
  number: string,
  token?: string,
) {
  const get = client(region, token);
  async function collect<T>(path: string, maxPages: number) {
    const entries: T[] = [];
    let hasNext = true;
    for (let page = 1; hasNext && page <= maxPages; page++) {
      const batch = await get<T[]>(
        `${path}?per_page=100&page=${page}`,
        (next) => {
          hasNext = next;
        },
        30_000,
      );
      entries.push(...batch);
    }
    return { entries, complete: !hasNext };
  }

  const comments = collect<{ user?: Login | null }>(
    `/issues/${number}/comments`,
    5,
  );
  if (scope === 'issue') {
    const [issue, discussion] = await Promise.all([
      get<{ user?: Login | null; comments: number; pull_request?: unknown }>(
        `/issues/${number}`,
        undefined,
        30_000,
      ),
      comments,
    ]);
    if (issue.pull_request) throw new GitHubError(404);
    return {
      comments: issue.comments,
      people: [
        issue.user,
        ...discussion.entries.map(({ user }) => user),
      ].flatMap((user) => (user ? [user.login] : [])),
      complete:
        discussion.complete && discussion.entries.length === issue.comments,
    } satisfies Discussion;
  }

  const [pull, discussion, commits, reviews] = await Promise.all([
    get<{ user?: Login | null; comments: number; commits: number }>(
      `/pulls/${number}`,
      undefined,
      30_000,
    ),
    comments,
    collect<{ sha: string }>(`/pulls/${number}/commits`, 3),
    collect<{ user?: Login | null; state: string; submitted_at?: string }>(
      `/pulls/${number}/reviews`,
      5,
    ),
  ]);
  const published = reviews.entries.filter(({ state }) => state !== 'PENDING');
  const effective = new Map<string, (typeof published)[number]>();
  for (const review of published) {
    const login = review.user?.login.toLowerCase();
    if (
      !login ||
      !review.submitted_at ||
      !['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)
    )
      continue;
    if (review.submitted_at >= (effective.get(login)?.submitted_at ?? ''))
      effective.set(login, review);
  }
  return {
    shas: commits.entries.map(({ sha }) => sha),
    commits: pull.commits,
    comments: pull.comments,
    reviews: reviews.complete ? published.length : undefined,
    people: [
      pull.user,
      ...discussion.entries.map(({ user }) => user),
      ...published.map(({ user }) => user),
    ].flatMap((user) => (user ? [user.login] : [])),
    complete:
      discussion.complete &&
      discussion.entries.length === pull.comments &&
      reviews.complete,
    opinion: reviews.complete
      ? latestOpinion(
          [...effective.values()].flatMap(({ state, submitted_at }) => {
            const opinion = reviewOpinion(state, submitted_at);
            return opinion ? [opinion] : [];
          }),
        )
      : undefined,
  } satisfies PullActivity;
}

const heritageTtl = 30 * 60_000;

async function repositoryHeritage(
  region: Region,
  token?: string,
): Promise<Heritage> {
  const data: Heritage = {};
  const get = client(region, token);
  const search = client(undefined, token, false, region.slug);
  function record(
    key: HeritageMetric,
    value: unknown,
    source: 'github' | 'search',
  ) {
    const count = verifiedCount(value);
    if (count !== undefined) data[key] = { count, source };
  }

  async function readIndexed(
    key: 'resolvedIssues' | 'mergedPulls',
    qualifiers: string,
  ) {
    const params = new URLSearchParams({
      q: `repo:${region.slug} ${qualifiers}`,
      per_page: '1',
    });
    const result = await search<{
      total_count: number;
      incomplete_results: boolean;
      items: { state?: string; state_reason?: string }[];
    }>(`/search/issues?${params}`, undefined, heritageTtl);
    if (
      result.incomplete_results !== false ||
      (key === 'resolvedIssues' &&
        result.total_count > 0 &&
        (result.items[0]?.state !== 'closed' ||
          result.items[0]?.state_reason !== 'completed'))
    )
      return;
    record(key, result.total_count, 'search');
  }

  async function readPullCounts() {
    if (!token) return readIndexed('mergedPulls', 'is:pr is:merged');

    const [owner, name] = region.slug.split('/');
    const result = await githubGraphql<{
      repository?: {
        mergedPulls: { totalCount: number };
        pulls: {
          totalCount: number;
          nodes: { reviews: { totalCount: number } }[];
        };
      };
    }>(
      `query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          mergedPulls: pullRequests(states: MERGED) { totalCount }
          pulls: pullRequests(first: 50) {
            totalCount
            nodes {
              reviews(states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) { totalCount }
            }
          }
        }
      }`,
      { owner, name },
      token,
      'heritage',
    );
    record('mergedPulls', result.repository?.mergedPulls?.totalCount, 'github');
    const pulls = result.repository?.pulls;
    if (!pulls || pulls.totalCount !== pulls.nodes.length) return;
    const counts = pulls.nodes.map((pull) =>
      verifiedCount(pull.reviews?.totalCount),
    );
    if (counts.every((count) => count !== undefined))
      record(
        'reviews',
        counts.reduce((sum, count) => sum + count, 0),
        'github',
      );
  }

  async function countComments(path: string) {
    let next = false;
    let link: string | null = null;
    const first = await get<unknown[]>(
      `${path}?per_page=1`,
      (more, header) => {
        next = more;
        link = header;
      },
      heritageTtl,
    );
    return onePerPageCount(first.length, next, link);
  }

  async function readComments() {
    const [discussion, inline] = await Promise.all([
      countComments('/issues/comments'),
      countComments('/pulls/comments'),
    ]);
    // GitHub truncates repository conversation pagination at 30,000 entries.
    if (discussion !== undefined && inline !== undefined && discussion < 30_000)
      record('comments', discussion + inline, 'github');
  }

  await Promise.allSettled([
    readIndexed('resolvedIssues', 'is:issue is:closed reason:completed'),
    readPullCounts(),
    readComments(),
  ]);
  return data;
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
  if (url.searchParams.get('debug') === 'usage')
    return githubDebugEnabled()
      ? reply(200, githubDebugSnapshot(credentialScope(authorization)))
      : reply(404, { error: '디버그 모드가 꺼져 있습니다.' });
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
      return reply(
        200,
        await activitySummary(region, summary, number, authorization),
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
      if (error.rateLimited)
        return reply(error.status, {
          error: 'GitHub API 사용 한도에 도달했습니다.',
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
