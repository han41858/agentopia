import type { BranchInventory } from './branch-roads.ts';
import { observeGitHub } from './github-query.ts';
import {
  linkedPullIssues,
  makeForges,
  makeQuests,
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
  Report,
  Run,
  Stage,
} from './model.ts';
import {
  publicReportTtl,
  publicRateLimit,
  GitHubError,
  client,
} from './github-client.ts';
import { nativePullLinks } from './github-pull-links.ts';

export const publicReports = new Map<
  string,
  { requestedAt: number; pending: boolean; value: Promise<Report> }
>();

export type Deployment = { id: number; environment: string; sha: string };

export type DeploymentStatus = {
  created_at?: string;
  state: string;
  description?: string;
};

export const releaseStages: Record<string, Stage> = {
  queued: 'queued',
  pending: 'queued',
  in_progress: 'deploying',
  success: 'complete',
  error: 'failed',
  failure: 'failed',
};

export const pageSize = 50;

export const recent = `?per_page=${pageSize}`;

export async function publicCommitSample(
  pull: Pull,
  get: ReturnType<typeof client>,
) {
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

export async function getReport(
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
        at: status.created_at,
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
      at: run.updated_at,
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
    branchPulls: pulls.flatMap((pull) =>
      (pull.state === 'open' || pull.merged_at) &&
      pull.base?.ref &&
      pull.head.ref &&
      pull.base.repo?.full_name.toLowerCase() === region.slug &&
      pull.head.repo?.full_name.toLowerCase() === region.slug
        ? [
            {
              number: pull.number,
              base: pull.base.ref,
              head: pull.head.ref,
              merged: Boolean(pull.merged_at),
            },
          ]
        : [],
    ),
    releases: releases
      .toSorted((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
      .map(({ title, url, status, stage, at }) => ({
        at,
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
  const limit = publicRateLimit.current;
  if (limit && limit.until > now) {
    if (!cached) throw limit.error;
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

export async function readBranches(
  region: Region,
  token?: string,
  force = false,
): Promise<BranchInventory> {
  const get = client(region, token, force);
  let partial = false;
  const [repository, branches] = await Promise.all([
    get<{ default_branch?: string }>('', undefined, 10 * 60_000),
    get<{ name: string }[]>(
      '/branches?per_page=100',
      (next) => {
        partial = next;
      },
      120_000,
    ),
  ]);
  if (!repository.default_branch) throw new GitHubError(502);
  return {
    defaultBranch: repository.default_branch,
    names: branches.map(({ name }) => name),
    partial,
  };
}
