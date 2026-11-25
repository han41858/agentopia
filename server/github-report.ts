import { preferredPalaceBranches } from './branch-roads.ts';
import type { BranchInventory } from './branch-roads.ts';
import { observeGitHub } from './github-query.ts';
import {
  linkedPullIssues,
  makeForges,
  makeQuests,
  readState,
  runIssue,
  selectIssueAutomation,
  stateMatchesRun,
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
} from './model.ts';
import {
  publicReportTtl,
  publicRateLimit,
  GitHubError,
  client,
} from './github-client.ts';
import { readAuthenticatedHistory, readTags } from './github-tags.ts';
import type { GitHubRelease } from './github-tags.ts';
import { nativePullLinks } from './github-pull-links.ts';

export const publicReports = new Map<
  string,
  { requestedAt: number; pending: boolean; value: Promise<Report> }
>();

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
  includeHistory = true,
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

  const authenticatedHistory =
    includeHistory && token
      ? optional('태그', readAuthenticatedHistory(region, token), undefined)
      : undefined;
  const restReleases = (fallback: GitHubRelease[] = []) =>
    optional(
      '릴리스',
      get<GitHubRelease[]>('/releases?per_page=30', undefined, 45_000),
      fallback,
    );
  const history = authenticatedHistory
    ? authenticatedHistory.then((result) => {
        if (!result || result.releasesFailed) warnings.add('릴리스');
        if (result?.tagsFailed) warnings.add('태그');
        if (result && !result.releasesFailed && !result.releasesTruncated)
          return result.releases;
        // Preserve the REST window when the creation-ordered page is cut off.
        // An older draft may have been published more recently than this page.
        return restReleases(result?.releases);
      })
    : includeHistory
      ? restReleases()
      : Promise.resolve([]);
  const latestPublishedTag = history.then(
    (rows) =>
      rows
        .filter((row) => !row.draft && row.published_at)
        .sort((a, b) => b.published_at!.localeCompare(a.published_at!))[0]
        ?.tag_name,
  );
  const current = Promise.all([
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
  ]);
  const tagsTask =
    authenticatedHistory ??
    (includeHistory
      ? optional('태그', readTags(region, force, latestPublishedTag), undefined)
      : undefined);
  const [issuePage, pullPage, workflow] = await current;
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
  const [, , comments] = await Promise.all([
    Promise.all(subIssueTasks),
    Promise.all(issueTasks),
    commentsTask,
  ]);
  // The repository-wide comment window can miss an active issue's checkpoint.
  const automation = selectIssueAutomation(region, runs, comments);
  const missingCheckpoints = [...automation].flatMap(
    ([number, { run, record }]) =>
      run?.status === 'in_progress' &&
      issues.get(number)?.state === 'open' &&
      !record
        ? [{ number, run }]
        : [],
  );
  const targeted = await Promise.all(
    missingCheckpoints.slice(0, 8).map(async ({ number, run }) => {
      const recent = await optional(
        'AI 상태 기록',
        get<Comment[]>(
          `/issues/${number}/comments?per_page=100&since=${encodeURIComponent(run.created_at)}`,
        ),
        [],
      );
      return recent.filter((entry) => {
        const state = readState(entry, region);
        return state && state.issue === number && stateMatchesRun(state, run);
      });
    }),
  );
  // Current-work lookups do not need publication history until attribution.
  const [releasePage, tagResult] = await Promise.all([history, tagsTask]);
  const tags = tagResult?.tags ?? [];
  if (tagResult?.dateLookupFailed) warnings.add('태그 커밋 시각');
  const tagCommits = new Map(tags.map((tag) => [tag.name, tag.sha]));
  for (const [name, sha] of tagResult?.releaseCommits ?? [])
    tagCommits.set(name, sha);
  // Only issue attribution needs a release outside the observed tag window resolved.
  if (pulls.some((pull) => pull.merged_at && pull.merge_commit_sha)) {
    await Promise.all(
      releasePage
        .filter(
          (release) =>
            !release.draft &&
            release.published_at &&
            !tagCommits.get(release.tag_name),
        )
        .toSorted((a, b) =>
          (b.published_at ?? '').localeCompare(a.published_at ?? ''),
        )
        .slice(0, token ? releasePage.length : 1)
        .map(async (release) => {
          const commit = await optional(
            '릴리스 커밋',
            get<{ sha: string }>(
              `/commits/refs%2Ftags%2F${encodeURIComponent(release.tag_name)}`,
              undefined,
              120_000,
            ),
            undefined,
          );
          if (commit?.sha) tagCommits.set(release.tag_name, commit.sha);
        }),
    );
  }
  const releases: Release[] = releasePage.flatMap((release) =>
    !release.draft && release.published_at
      ? [
          {
            title: release.tag_name,
            url: release.html_url,
            status: release.prerelease ? '사전 릴리스' : '릴리스',
            sha: tagCommits.get(release.tag_name),
            at: release.published_at,
            stage: 'complete' as const,
          },
        ]
      : [],
  );
  releases.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  const quests = makeQuests(
    region,
    [...issues.values()],
    pulls,
    runs,
    comments.concat(...targeted),
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
    releases,
    tags: tags.map(({ name, committedAt }) => ({ name, committedAt })),
    tagsPartial: tagResult?.partial,
    updatedAt: new Date().toISOString(),
    warnings: [...warnings].sort(),
  };
}

export function regionReport(
  region: Region,
  token?: string,
  force = false,
  includeHistory = true,
) {
  if (token) return getReport(region, token, force, includeHistory || force);
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
  const branchTtl = 120_000;
  const [repository, branches] = await Promise.all([
    get<{ default_branch?: string }>('', undefined, 10 * 60_000),
    get<{ name: string }[]>(
      '/branches?per_page=100',
      (next) => {
        partial = next;
      },
      branchTtl,
    ),
  ]);
  const defaultBranch = repository.default_branch;
  if (!defaultBranch) throw new GitHubError(502);
  const names = branches.map(({ name }) => name);
  if (partial) {
    // A truncated list cannot rule out a higher-priority palace branch.
    for (const name of preferredPalaceBranches) {
      if (name === defaultBranch || names.includes(name)) break;
      const branch = await get<{ name: string } | null>(
        `/branches/${name}`,
        undefined,
        branchTtl,
        'branch-probe',
      );
      if (branch) {
        names.push(branch.name);
        break;
      }
    }
  }
  return { defaultBranch, names, partial };
}
