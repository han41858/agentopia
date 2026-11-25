import { branchIssueNumber } from './branch-roads.ts';
import type { BranchInventory, BranchPull } from './branch-roads.ts';
import { summarizeActivity } from './activity.ts';
import type { ActivityProfile, PullActivity } from './activity.ts';

export type Region = {
  slug: string;
  name: string;
};

export type Repository = { slug: string; private: boolean };
export type RepositoryPage = { repositories: Repository[]; next?: string };

export function repositoryOwner(value: string) {
  const owner = value.trim();
  return /^[a-z\d][a-z\d-]{0,38}$/i.test(owner)
    ? owner.toLowerCase()
    : undefined;
}

export function repositorySlug(value: string) {
  const match = /^([a-z\d][a-z\d-]{0,38})\/([a-z\d_.-]{1,100})$/i.exec(value);
  if (!match || match[2] === '.' || match[2] === '..') return undefined;
  return `${match[1]}/${match[2]}`.toLowerCase();
}

export function repositoryInput(value: string) {
  const input = value.trim();
  const url = /^https?:\/\/github\.com\/([^?#]+)\/?$/i.exec(input);
  return repositorySlug(
    url ? url[1].replace(/\/$/, '').replace(/\.git$/i, '') : input,
  );
}

export function repositoryRegion(slug: string): Region {
  const [, name] = slug.split('/');
  return { slug, name };
}
export type Stage =
  | 'idle'
  | 'queued'
  | 'developing'
  | 'revising'
  | 'reviewing'
  | 'ci'
  | 'deploying'
  | 'merging'
  | 'complete'
  | 'returned'
  | 'failed'
  | 'attention';
export const stages: Record<Stage, string> = {
  idle: '대기',
  queued: '출정 준비',
  developing: '모험가 전투',
  revising: '재전투',
  reviewing: '모험가 검토',
  ci: '시련의 관문',
  merging: '공략 결과 병합 중',
  deploying: '포탈 개방',
  complete: '전투 승리',
  returned: '귀환',
  failed: '실행 실패',
  attention: '개입 필요',
};

export type Agent = 'codex' | 'claude';
export type AdventurerRole = 'develop' | 'review';
export type Adventurer = {
  agent: Agent;
  roles: AdventurerRole[];
  active?: AdventurerRole;
  fallen?: boolean;
};
export type Source = { title: string; url: string; status?: string };
export type WorkflowRunRecord = Source & { startedAt?: string };
export type ActivityKind = 'commits' | 'comments' | 'reviews';
export type ActivityCounts = Partial<Record<ActivityKind, number>>;
export type ActivityEntry = Source & {
  author?: string;
  body?: string;
  at?: string;
};
export type ActivityPage = { entries: ActivityEntry[]; next?: number };

export type Quest = {
  number: number;
  title: string;
  url: string;
  stage: Stage;
  state: Issue['state'];
  stateReason?: Issue['state_reason'];
  released?: boolean;
  victory?: boolean;
  adventurers?: Adventurer[];
  activities?: ActivityCounts;
  activity?: ActivityProfile;
  reopened?: boolean;
  workPull?: number;
  workReviewer?: Agent;
  issueComments?: number;
  subIssueCount?: number;
  parent?: number;
  reason?: string;
  detail?: string;
  evidence?: Source;
  developer?: Agent;
  reviewer?: Agent;
  review?: string;
  pulls: (Source & {
    number: number;
    mergeSha?: string;
    activities?: ActivityCounts;
  })[];
  commit?: Source;
  runs: WorkflowRunRecord[];
};
export type PullQuest = Source & {
  number: number;
  draft: boolean;
  merged?: boolean;
  cancelled?: boolean;
  finishedAt?: string;
  issues?: number[];
  adventurers?: Adventurer[];
  quality?: Stage;
  ciParticipated?: boolean;
  activity?: ActivityProfile;
  activities?: ActivityCounts;
  stage: Stage;
  author?: Agent;
  reviewer?: Agent;
  review?: string;
  runs: WorkflowRunRecord[];
};

export type PullLinks = {
  reviewParticipants?: Agent[];
  activity?: PullActivity;
  issues: number[];
  activities?: ActivityCounts;
  reviewer?: Agent;
  review?: string;
};

export type Report = {
  quests: Quest[];
  pullQuests?: PullQuest[];
  forges?: PullQuest[];
  branchInventory?: BranchInventory;
  branchPulls?: BranchPull[];
  tags?: { name: string; committedAt?: string }[];
  tagsPartial?: boolean;
  releases: Release[];
  updatedAt: string;
  warnings: string[];
};

export type Issue = {
  number: number;
  title: string;
  html_url: string;
  state: string;
  state_reason?: string | null;
  pull_request?: unknown;
  user?: { login: string } | null;
  labels: { name: string }[];
  comments?: number;
  sub_issues_summary?: { total: number };
};
export type Pull = {
  number: number;
  title: string;
  html_url: string;
  state: string;
  draft: boolean;
  body: string | null;
  user?: { login: string; type?: string };
  head: { ref: string; sha: string; repo?: { full_name: string } | null };
  base?: { ref: string; repo?: { full_name: string } | null };
  merge_commit_sha?: string;
  merged_at?: string | null;
  closed_at?: string | null;
  updated_at: string;
};
export type Run = {
  id: number;
  run_attempt: number;
  name: string;
  display_title: string;
  path: string;
  event: string;
  html_url: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  run_started_at?: string | null;
  updated_at: string;
  head_branch: string;
  head_sha: string;
  pull_requests: { number: number }[];
};
export type Comment = {
  body: string;
  user?: { login: string };
  issue_url: string;
  html_url: string;
  updated_at: string;
};
export type Release = Source & { stage: 'complete'; sha?: string; at?: string };
type AutomationState = {
  issue: number;
  runId: number;
  attempt?: number;
  status: string;
  developer?: Agent;
  reviewer?: Agent;
  reviewInProgress?: string;
  reason?: string;
  detail?: string;
  base?: string;
  head?: string;
  reviews?: { head: string; result?: { status: string } }[];
};

const automationStages: Record<string, Stage> = {
  queued: 'queued',
  developing: 'developing',
  revising: 'revising',
  recovering: 'revising',
  reviewing: 'reviewing',
  ready: 'ci',
  merging: 'merging',
  merged: 'complete',
  needs_human: 'attention',
  failed: 'failed',
};

export function runIssue(run: Run) {
  if (run.path.split('@')[0] !== '.github/workflows/ai-development.yml') return;
  const match = /^AI development for Issue #(\d+)$/.exec(run.display_title);
  return match ? Number(match[1]) : undefined;
}

export function pullIssue(pull: Pull, region: Region) {
  if (pull.head.repo?.full_name.toLowerCase() !== region.slug) return;
  return branchIssueNumber(pull.head.ref);
}

export function pullActor(login?: string, type?: string): Agent | undefined {
  const account = login?.toLowerCase();
  if (type !== 'Bot' && !account?.endsWith('[bot]')) return;
  switch (account) {
    case 'codex':
    case 'codex[bot]':
    case 'chatgpt-codex-connector':
    case 'chatgpt-codex-connector[bot]':
      return 'codex';
    case 'claude':
    case 'claude[bot]':
    case 'claude-code':
    case 'claude-code[bot]':
      return 'claude';
  }
}

export function linkedPullIssues(
  pull: Pull,
  region: Region,
  native?: PullLinks,
) {
  const numbers = new Set(native?.issues ?? []);
  const branch = pullIssue(pull, region);
  if (branch !== undefined) numbers.add(branch);
  const body = (pull.body ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*`{3,}[\s\S]*?^[ \t]*`{3,}[^\n]*/gm, '')
    .replace(/^[ \t]*~{3,}[\s\S]*?^[ \t]*~{3,}[^\n]*/gm, '')
    .replace(/^[ \t]*>.*$/gm, '')
    .replace(/`+[^`]*`+/g, '');
  const references = body.matchAll(
    /\b(?:clos(?:e[sd]?)|fix(?:e[sd])?|resolv(?:e[sd]?))[ \t]*:?[ \t]+((?:[\w.-]+\/[\w.-]+)?#\d+|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+)(?![\w/])/gi,
  );
  for (const [, reference] of references) {
    const match =
      /^(?:(?<repo>[\w.-]+\/[\w.-]+)?#|https:\/\/github\.com\/(?<urlRepo>[\w.-]+\/[\w.-]+)\/issues\/)(?<number>\d+)$/i.exec(
        reference,
      );
    if (!match?.groups) continue;
    const repo = (match.groups.repo ?? match.groups.urlRepo)?.toLowerCase();
    const number = Number(match.groups.number);
    if (
      (!repo || repo === region.slug) &&
      Number.isSafeInteger(number) &&
      number > 0
    )
      numbers.add(number);
  }
  return [...numbers];
}

export function readState(comment: Comment, region: Region) {
  if (comment.user?.login !== 'github-actions[bot]') return;
  const prefix = `<!-- ${region.slug.split('/')[1]}-ai-state:`;
  const offset = comment.body?.lastIndexOf(prefix) ?? -1;
  if (offset < 0) return;
  const marker = comment.body
    .slice(offset + prefix.length)
    .match(/^([a-zA-Z0-9+/=]+) -->\s*$/);
  if (!marker) return;
  try {
    const { run: alias, ...state } = JSON.parse(
      Buffer.from(marker[1], 'base64').toString('utf8'),
    ) as AutomationState & { run?: unknown };
    const run =
      typeof alias === 'string' && String(Number(alias)) === alias
        ? Number(alias)
        : alias;
    const runId = state.runId === undefined ? run : state.runId;
    if (
      typeof runId === 'number' &&
      Number.isSafeInteger(runId) &&
      runId > 0 &&
      (alias === undefined || run === runId) &&
      (state.attempt === undefined ||
        (Number.isSafeInteger(state.attempt) && state.attempt > 0)) &&
      state.issue === Number(comment.issue_url.split('/').pop()) &&
      typeof state.status === 'string' &&
      Object.hasOwn(automationStages, state.status)
    )
      return { ...state, runId };
  } catch {
    return;
  }
}

type StateRecord = { state: AutomationState; comment: Comment };

type IssueAutomation = {
  runs: Run[];
  records: StateRecord[];
  run?: Run;
  record?: StateRecord;
};

export function stateMatchesRun(state: AutomationState, run: Run) {
  return state.runId === run.id && (state.attempt ?? 1) === run.run_attempt;
}

export function selectIssueAutomation(
  region: Region,
  runs: Run[],
  comments: Comment[],
) {
  const byIssue = new Map<number, IssueAutomation>();
  function forIssue(number: number) {
    let entry = byIssue.get(number);
    if (!entry) {
      entry = { runs: [], records: [] };
      byIssue.set(number, entry);
    }
    return entry;
  }

  for (const run of runs) {
    const number = runIssue(run);
    if (number !== undefined) forIssue(number).runs.push(run);
  }
  for (const comment of comments) {
    const state = readState(comment, region);
    if (state) forIssue(state.issue).records.push({ state, comment });
  }

  for (const entry of byIssue.values()) {
    const latestAttempts = new Map<number, Run>();
    for (const run of entry.runs) {
      const previous = latestAttempts.get(run.id);
      if (!previous || run.run_attempt > previous.run_attempt)
        latestAttempts.set(run.id, run);
    }
    const candidates = [...latestAttempts.values()].sort((a, b) => b.id - a.id);
    const record = entry.records
      .filter(({ state }) => {
        const run = latestAttempts.get(state.runId);
        if (!run) return true;
        const attempt = state.attempt ?? 1;
        return (
          attempt > run.run_attempt ||
          (attempt === run.run_attempt && run.conclusion !== 'skipped')
        );
      })
      .sort(
        (a, b) =>
          b.state.runId - a.state.runId ||
          (b.state.attempt ?? 1) - (a.state.attempt ?? 1) ||
          Date.parse(b.comment.updated_at) - Date.parse(a.comment.updated_at),
      )[0];

    // A parallel trigger can exit without writing a checkpoint. A newer
    // success alone does not establish recovery from a recorded failure.
    const run = candidates.find(
      (candidate) =>
        candidate.conclusion !== 'skipped' &&
        (candidate.conclusion !== 'cancelled' ||
          entry.records.some(({ state }) =>
            stateMatchesRun(state, candidate),
          )) &&
        !(
          record?.state.status === 'failed' &&
          candidate.id > record.state.runId &&
          candidate.conclusion === 'success'
        ),
    );
    if (
      record &&
      (!run ||
        stateMatchesRun(record.state, run) ||
        record.state.runId > run.id ||
        (record.state.runId === run.id &&
          (record.state.attempt ?? 1) > run.run_attempt))
    ) {
      entry.record = record;
      // The checkpoint can be newer than the available Actions snapshot.
      if (run && stateMatchesRun(record.state, run)) entry.run = run;
    } else {
      // Keep reporting cancellation when there is no better evidence of work.
      entry.run =
        run ??
        candidates.find((candidate) => candidate.conclusion === 'cancelled');
    }
  }
  return byIssue;
}

export function runStage(run: Pick<Run, 'status' | 'conclusion'>): Stage {
  if (
    run.status === 'waiting' ||
    run.status === 'action_required' ||
    run.conclusion === 'action_required'
  )
    return 'attention';
  if (run.status !== 'completed')
    return run.status === 'in_progress' ? 'developing' : 'queued';
  if (
    ['failure', 'timed_out', 'startup_failure', 'stale'].includes(
      run.conclusion ?? '',
    )
  )
    return 'failed';
  if (run.conclusion === 'cancelled') return 'attention';
  return run.conclusion === 'success' ? 'complete' : 'idle';
}

function runSource(run: Run): WorkflowRunRecord {
  return {
    title: run.name,
    url: run.html_url,
    status:
      run.status === 'completed' ? (run.conclusion ?? run.status) : run.status,
    startedAt: run.run_started_at ?? undefined,
  };
}

function latestWorkflowRuns(runs: WorkflowRunRecord[]): WorkflowRunRecord[] {
  return runs
    .map((run) => {
      const start = Date.parse(run.startedAt ?? '');
      return { run, start: Number.isNaN(start) ? -Infinity : start };
    })
    .sort((a, b) => (a.start === b.start ? 0 : b.start - a.start))
    .slice(0, 8)
    .map(({ run }) => run);
}

export function makeForges(
  region: Region,
  pulls: Pull[],
  runs: Run[],
  links: ReadonlyMap<number, PullLinks>,
  quests: Quest[] = [],
): PullQuest[] {
  const work = new Map<number, Quest[]>();
  for (const quest of quests) {
    if (quest.workPull === undefined) continue;
    const current = work.get(quest.workPull) ?? [];
    current.push(quest);
    work.set(quest.workPull, current);
  }
  return pulls
    .filter(
      (pull) =>
        pull.state === 'open' ||
        pull.state === 'closed' ||
        Boolean(pull.merged_at),
    )
    .map((pull) => {
      const relatedRuns = runs.filter(
        (run) =>
          run.head_sha === pull.head.sha &&
          (run.pull_requests.some(({ number }) => number === pull.number) ||
            (pull.head.repo?.full_name.toLowerCase() === region.slug &&
              run.head_branch === pull.head.ref)),
      );
      const ci = relatedRuns.find(
        (run) => run.path.split('@')[0] === '.github/workflows/ci.yml',
      );
      const outcome = ci ? runStage(ci) : 'idle';
      const review = links.get(pull.number);
      const cancelled = pull.state === 'closed' && !pull.merged_at;
      const relatedWork =
        pull.merged_at || cancelled ? [] : (work.get(pull.number) ?? []);
      const workers = new Map<Agent, Adventurer>();
      for (const quest of relatedWork) {
        for (const member of quest.adventurers ?? []) {
          if (!member.active && !member.fallen) {
            const roles = member.roles.filter((role) =>
              role === 'review'
                ? member.agent === quest.workReviewer
                : member.agent === quest.developer,
            );
            if (roles.length) {
              const prior = workers.get(member.agent);
              workers.set(member.agent, {
                ...prior,
                agent: member.agent,
                roles: [...new Set([...(prior?.roles ?? []), ...roles])],
              });
            }
            continue;
          }
          const previous = workers.get(member.agent);
          workers.set(member.agent, {
            ...member,
            roles: [...new Set([...(previous?.roles ?? []), ...member.roles])],
            active: member.active ?? previous?.active,
            fallen:
              !member.active &&
              !previous?.active &&
              Boolean(member.fallen || previous?.fallen),
          });
        }
      }
      for (const agent of review?.reviewParticipants ??
        (review?.reviewer ? [review.reviewer] : [])) {
        const member: Adventurer = workers.get(agent) ?? { agent, roles: [] };
        if (!member.roles.includes('review')) member.roles.push('review');
        workers.set(agent, member);
      }
      const adventurers = [...workers.values()];
      const quality =
        outcome === 'developing' || outcome === 'queued'
          ? 'ci'
          : outcome === 'attention' || outcome === 'failed'
            ? outcome
            : undefined;
      const stage = pull.merged_at
        ? 'complete'
        : cancelled
          ? 'idle'
          : quality === 'failed' || quality === 'attention'
            ? quality
            : adventurers.some((member) => member.fallen)
              ? 'failed'
              : adventurers.some((member) => member.active === 'review')
                ? 'reviewing'
                : adventurers.some((member) => member.active === 'develop')
                  ? relatedWork.some((quest) => quest.stage === 'revising')
                    ? 'revising'
                    : 'developing'
                  : (quality ??
                    (relatedWork.some((quest) => quest.stage === 'merging')
                      ? 'merging'
                      : 'idle'));
      return {
        number: pull.number,
        title: pull.title,
        url: pull.html_url,
        draft: pull.draft,
        merged: Boolean(pull.merged_at),
        cancelled,
        finishedAt:
          pull.merged_at ||
          (cancelled ? (pull.closed_at ?? pull.updated_at) : undefined),
        issues: linkedPullIssues(pull, region, review),
        adventurers,
        ciParticipated:
          Boolean(ci) ||
          runs.some(
            (run) =>
              run.path.split('@')[0] === '.github/workflows/ci.yml' &&
              run.pull_requests.some(({ number }) => number === pull.number),
          ),
        quality: pull.merged_at || cancelled ? undefined : quality,
        activity: summarizeActivity(undefined, [
          pullDiscussion(pull, review?.activity),
        ]),
        activities: review?.activities,
        stage,
        author: pullActor(pull.user?.login, pull.user?.type),
        reviewer: review?.reviewer,
        review: review?.review,
        runs: latestWorkflowRuns([
          ...new Map(
            [
              ...relatedWork.flatMap((quest) => quest.runs),
              ...relatedRuns.map(runSource),
            ].map((run) => [run.url, run]),
          ).values(),
        ]),
      };
    });
}

export function makePullQuests(
  region: Region,
  pulls: Pull[],
  runs: Run[],
  issueNumbers: ReadonlySet<number>,
  links: ReadonlyMap<number, PullLinks>,
) {
  return makeForges(region, pulls, runs, links).filter(
    (pull) =>
      !pull.cancelled &&
      !pull.issues?.some((number) => issueNumbers.has(number)),
  );
}

function pullDiscussion(
  pull: Pull,
  known?: PullActivity,
  commenters: string[] = [],
): PullActivity {
  return {
    shas: [],
    ...known,
    complete: known?.complete ?? false,
    people: [
      pull.user?.login ?? '',
      ...(known?.people ?? []),
      ...commenters,
    ].filter(Boolean),
  };
}

export function withPublishedRelease(quest: Quest, releases: Release[]): Quest {
  const release = releases.find(
    (item) =>
      item.sha && quest.pulls.some((pull) => pull.mergeSha === item.sha),
  );
  if (!release) return quest;
  return quest.stage === 'complete'
    ? { ...quest, released: true, evidence: release, reason: release.status }
    : { ...quest, released: true };
}

export function makeQuests(
  region: Region,
  issues: Issue[],
  pulls: Pull[],
  runs: Run[],
  comments: Comment[],
  parents: Map<number, number>,
  releases: Release[],
  pullLinks: ReadonlyMap<number, PullLinks> = new Map(),
): Quest[] {
  const byIssue = selectIssueAutomation(region, runs, comments);

  const pullsByIssue = new Map<number, Pull[]>();
  for (const pull of pulls) {
    for (const number of linkedPullIssues(
      pull,
      region,
      pullLinks.get(pull.number),
    )) {
      const entries = pullsByIssue.get(number) ?? [];
      entries.push(pull);
      pullsByIssue.set(number, entries);
    }
  }
  const childrenByIssue = new Map<number, number>();
  for (const parent of parents.values())
    childrenByIssue.set(parent, (childrenByIssue.get(parent) ?? 0) + 1);

  const discussion = new Map<number, Map<string, string>>();
  for (const entry of comments) {
    const number = Number(entry.issue_url.split('/').pop());
    const conversation = discussion.get(number) ?? new Map<string, string>();
    conversation.set(entry.html_url, entry.user?.login ?? '');
    discussion.set(number, conversation);
  }

  return issues.map((issue) => {
    const issuePulls = pullsByIssue.get(issue.number) ?? [];
    const selection = byIssue.get(issue.number);
    const automation = selection?.runs ?? [];
    const record = selection?.record;
    const run = selection?.run;
    const state = record?.state;
    const runPulls = issuePulls.filter(
      (item) =>
        item.state === 'open' &&
        run?.pull_requests.some(({ number }) => number === item.number),
    );
    const headPulls = issuePulls.filter(
      (item) => item.state === 'open' && item.head.sha === state?.head,
    );
    const workPull =
      runPulls.length === 1
        ? runPulls[0]
        : headPulls.length === 1
          ? headPulls[0]
          : undefined;
    const pull = workPull ?? issuePulls[0];
    const ci = runs.find(
      (candidate) =>
        candidate.path.split('@')[0] === '.github/workflows/ci.yml' &&
        candidate.head_sha === (pull?.head.sha ?? state?.head) &&
        (candidate.head_branch === pull?.head.ref ||
          candidate.pull_requests.some(
            ({ number }) => number === pull?.number,
          )),
    );
    // Earlier CI attempts remain visible in Actions history after recovery changes the head.
    const earlierCI = pull
      ? runs.filter(
          (candidate) =>
            candidate.id !== ci?.id &&
            candidate.path.split('@')[0] === '.github/workflows/ci.yml' &&
            candidate.pull_requests.some((item) => item.number === pull.number),
        )
      : [];
    const branch =
      pull && pullIssue(pull, region) === issue.number ? pull.head.ref : '';
    const developer =
      state?.developer === 'codex' || state?.developer === 'claude'
        ? state.developer
        : branch.endsWith('-codex')
          ? 'codex'
          : branch.endsWith('-claude')
            ? 'claude'
            : undefined;
    const reviewer =
      state?.reviewer === 'codex' || state?.reviewer === 'claude'
        ? state.reviewer
        : pull && pullLinks.get(pull.number)?.reviewer;
    let stage: Stage = state ? automationStages[state.status] : 'idle';
    let evidence: Source | undefined =
      state && record
        ? {
            title: 'GitHub Actions 상태 기록',
            url: record.comment.html_url,
            status: state.status,
          }
        : undefined;
    let reason = state?.reason;
    if (state?.status === 'needs_human' && !/[\p{L}\p{N}]/u.test(reason ?? ''))
      reason =
        '자동화가 사람 확인을 요청했습니다. 실행 기록에 구체적인 중단 사유가 없습니다.';
    let detail = state?.detail;
    const outcome = run && runStage(run);
    if (
      run &&
      (outcome === 'failed' || outcome === 'attention') &&
      state?.status !== 'needs_human' &&
      stage !== 'complete'
    ) {
      stage = outcome;
      evidence = runSource(run);
      reason =
        state?.status === 'failed'
          ? state.reason
          : `AI development · ${evidence.status}`;
      detail = state?.status === 'failed' ? state.detail : undefined;
    } else if (
      run &&
      !state &&
      (outcome === 'queued' || outcome === 'developing')
    ) {
      stage = outcome;
      evidence = runSource(run);
    }
    const review = state?.reviews?.findLast(
      (item) => item.head === (pull?.head.sha ?? state.head),
    )?.result?.status;
    if (
      ci &&
      (stage === 'ci' ||
        (stage === 'idle' && pull?.state === 'open') ||
        (stage === 'reviewing' && review === 'pass'))
    ) {
      const ciStage = runStage(ci);
      if (ciStage !== 'complete') {
        stage =
          ciStage === 'failed' || ciStage === 'attention' ? ciStage : 'ci';
        evidence = runSource(ci);
        reason = `CI · ${evidence.status}`;
      }
    }
    const victory =
      issuePulls.some((item) => item.merged_at) || state?.status === 'merged';
    const reviewedPullMerged =
      state?.status === 'ready' &&
      issuePulls.some((item) => item.merged_at && item.head.sha === state.head);
    if ((stage === 'idle' && victory) || reviewedPullMerged) {
      stage = 'complete';
    }
    if (
      run?.status === 'completed' &&
      (!state ||
        (state.runId === run.id && (state.attempt ?? 1) === run.run_attempt)) &&
      ((stage === 'idle' && outcome === 'complete') ||
        stage === 'queued' ||
        stage === 'developing' ||
        stage === 'revising' ||
        stage === 'reviewing' ||
        stage === 'merging')
    ) {
      stage = 'returned';
      evidence = runSource(run);
    }
    if (
      issue.labels.some(({ name }) => name === 'ai:stop') &&
      issue.state === 'open'
    ) {
      stage = 'attention';
      evidence = {
        title: 'Issue 라벨',
        url: issue.html_url,
        status: 'ai:stop',
      };
      reason = 'Issue에 ai:stop 라벨이 지정되어 있습니다.';
      detail = undefined;
    }

    const adventurers = new Map<Agent, Adventurer>();
    const matchingRun = Boolean(run && state && stateMatchesRun(state, run));
    const running = matchingRun && run?.status === 'in_progress';
    const addAdventurer = (
      agent: Agent,
      role: AdventurerRole,
      active: boolean,
      fallen = false,
    ) => {
      const member = adventurers.get(agent) ?? { agent, roles: [] };
      if (!member.roles.includes(role)) member.roles.push(role);
      if (active) member.active = role;
      if (fallen) member.fallen = true;
      adventurers.set(agent, member);
    };
    const developmentRecorded = Boolean(
      branch ||
      (state &&
        [
          'developing',
          'revising',
          'reviewing',
          'ready',
          'merging',
          'merged',
        ].includes(state.status)),
    );
    if (developer && developmentRecorded)
      addAdventurer(
        developer,
        'develop',
        running &&
          state?.status !== 'recovering' &&
          (stage === 'developing' || stage === 'revising'),
        matchingRun &&
          outcome === 'failed' &&
          (state?.status === 'developing' || state?.status === 'revising'),
      );
    const submittedReviewer = pull && pullLinks.get(pull.number)?.reviewer;
    for (const { state: previous } of selection?.records ?? []) {
      if (
        (previous.reviewer === 'codex' || previous.reviewer === 'claude') &&
        (previous.reviewInProgress || previous.reviews?.length)
      )
        addAdventurer(previous.reviewer, 'review', false);
    }
    for (const item of issuePulls) {
      const link = pullLinks.get(item.number);
      for (const agent of link?.reviewParticipants ??
        (link?.reviewer ? [link.reviewer] : []))
        addAdventurer(agent, 'review', false);
    }
    const reviewRecorded = Boolean(
      state?.reviewInProgress || state?.reviews?.length,
    );
    if (
      state?.reviewer &&
      (state.reviewer === 'codex' || state.reviewer === 'claude') &&
      reviewRecorded
    ) {
      const reviewingHead =
        Boolean(state.reviewInProgress) &&
        state.reviewInProgress === (pull?.head.sha ?? state.head);
      const active = running && stage === 'reviewing' && reviewingHead;
      const fallen = matchingRun && outcome === 'failed' && reviewingHead;
      if (state.reviewer !== submittedReviewer || active || fallen)
        addAdventurer(state.reviewer, 'review', active, fallen);
    }

    const commit =
      !issuePulls.length &&
      state?.base &&
      state.head &&
      state.head !== state.base &&
      /^[a-f0-9]{40}$/i.test(state.head)
        ? {
            title: `커밋 ${state.head.slice(0, 7)}`,
            url: `https://github.com/${region.slug}/commit/${state.head}`,
          }
        : undefined;

    const issueDiscussion = discussion.get(issue.number);
    const activity = summarizeActivity(
      {
        comments: issue.comments,
        people: [
          issue.user?.login ?? '',
          ...(issueDiscussion?.values() ?? []),
        ].filter(Boolean),
        complete:
          issue.comments !== undefined &&
          issue.comments === (issueDiscussion?.size ?? 0),
      },
      issuePulls.map((pull) =>
        pullDiscussion(pull, pullLinks.get(pull.number)?.activity, [
          ...(discussion.get(pull.number)?.values() ?? []),
        ]),
      ),
    );
    const activities = {
      commits: activity.commits,
      comments: activity.issueComments,
      reviews: activity.reviews,
    };

    const quest: Quest = {
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      stage,
      state: issue.state,
      stateReason: issue.state_reason,
      reopened:
        issue.state === 'open' && issue.state_reason === 'reopened'
          ? true
          : undefined,
      victory,
      workReviewer:
        workPull &&
        state?.reviewer &&
        (state.reviewInProgress === workPull.head.sha ||
          state.reviews?.some((review) => review.head === workPull.head.sha))
          ? state.reviewer
          : undefined,
      workPull:
        matchingRun && issue.state === 'open' ? workPull?.number : undefined,
      adventurers: [...adventurers.values()],
      activities,
      activity,
      issueComments: issue.comments,
      subIssueCount:
        Math.max(
          issue.sub_issues_summary?.total ?? 0,
          childrenByIssue.get(issue.number) ?? 0,
        ) || undefined,
      parent: parents.get(issue.number),
      reason,
      detail,
      evidence,
      developer,
      reviewer,
      review,
      commit,
      pulls: issuePulls.map((item) => ({
        number: item.number,
        mergeSha: item.merged_at
          ? (item.merge_commit_sha ?? undefined)
          : undefined,
        title: item.title,
        url: item.html_url,
        activities: pullLinks.get(item.number)?.activities,
        status: item.merged_at
          ? 'merged'
          : item.draft && item.state === 'open'
            ? 'draft'
            : item.state,
      })),
      runs: latestWorkflowRuns(
        [...automation, ...(ci ? [ci] : []), ...earlierCI].map(runSource),
      ),
    };
    return withPublishedRelease(quest, releases);
  });
}
