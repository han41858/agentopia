export const regions = [
  {
    id: 'commit-trail',
    slug: 'han41858/commit-trail',
    name: 'Commit Trail',
    title: '태엽의 기록성',
    theme: 'amber',
    description: '시간을 기록하는 기계와 고대의 문서가 잠든 성채.',
  },
  {
    id: 'videx',
    slug: 'han41858/videx',
    name: 'Videx',
    title: '환영의 극장',
    theme: 'violet',
    description: '별빛과 마법으로 이야기를 비추는 보랏빛 극장.',
  },
] as const;

export type Region = {
  id: string;
  slug: string;
  name: string;
  title: string;
  theme: 'amber' | 'violet';
  description: string;
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
  const known = regions.find((region) => region.slug === slug);
  if (known) return known;
  const [owner, name] = slug.split('/');
  return {
    id: slug,
    slug,
    name,
    title: owner,
    theme: 'amber',
    description: slug,
  };
}
export type Stage =
  | 'idle'
  | 'queued'
  | 'developing'
  | 'reviewing'
  | 'ci'
  | 'deploying'
  | 'merging'
  | 'complete'
  | 'failed'
  | 'attention';
export const stages: Record<Stage, string> = {
  idle: '대기',
  queued: '출정 대기',
  developing: '제작 · 탐험',
  reviewing: '현자의 검토',
  ci: '시련의 관문',
  merging: '변경 병합 중',
  deploying: '포탈 개방',
  complete: '퀘스트 클리어',
  failed: '파티 전멸',
  attention: '개입 필요',
};

export type Agent = 'codex' | 'claude';
export type Source = { title: string; url: string; status?: string };
export type Quest = {
  number: number;
  title: string;
  url: string;
  stage: Stage;
  state: Issue['state'];
  stateReason?: Issue['state_reason'];
  subIssueCount?: number;
  parent?: number;
  reason?: string;
  detail?: string;
  evidence?: Source;
  developer?: Agent;
  reviewer?: Agent;
  review?: string;
  pulls: (Source & { number: number })[];
  runs: Source[];
};
export type PullQuest = Source & {
  number: number;
  draft: boolean;
  stage: Stage;
  author?: Agent;
  reviewer?: Agent;
  review?: string;
  runs: Source[];
};

export type PullLinks = {
  issues: number[];
  reviewer?: Agent;
  review?: string;
};

export type Report = {
  quests: Quest[];
  pullQuests?: PullQuest[];
  releases: (Source & { stage: Stage })[];
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
  labels: { name: string }[];
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
  head: { ref: string; sha: string; repo?: { full_name: string } };
  merge_commit_sha?: string;
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
export type Release = Source & { stage: Stage; sha?: string };
type AutomationState = {
  issue: number;
  runId: number;
  attempt?: number;
  status: string;
  developer?: Agent;
  reviewer?: Agent;
  reason?: string;
  detail?: string;
  head?: string;
  reviews?: { head: string; result?: { status: string } }[];
};

const automationStages: Record<string, Stage> = {
  queued: 'queued',
  developing: 'developing',
  revising: 'developing',
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
  const branch = /^ai\/issue-(\d+)-(codex|claude)$/.exec(pull.head.ref);
  if (!branch) return;
  return Number(branch[1]);
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
    const state = JSON.parse(
      Buffer.from(marker[1], 'base64').toString('utf8'),
    ) as AutomationState;
    if (
      Number.isSafeInteger(state.runId) &&
      state.issue === Number(comment.issue_url.split('/').pop()) &&
      Object.hasOwn(automationStages, state.status)
    )
      return state;
  } catch {
    return;
  }
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

function runSource(run: Run): Source {
  return {
    title: run.name,
    url: run.html_url,
    status: run.conclusion ?? run.status,
  };
}

export function makePullQuests(
  region: Region,
  pulls: Pull[],
  runs: Run[],
  issueNumbers: ReadonlySet<number>,
  links: ReadonlyMap<number, PullLinks>,
): PullQuest[] {
  return pulls
    .filter(
      (pull) =>
        pull.state === 'open' &&
        !linkedPullIssues(pull, region, links.get(pull.number)).some((number) =>
          issueNumbers.has(number),
        ),
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
      return {
        number: pull.number,
        title: pull.title,
        url: pull.html_url,
        draft: pull.draft,
        stage:
          outcome === 'developing' || outcome === 'queued'
            ? 'ci'
            : outcome === 'attention' || outcome === 'failed'
              ? outcome
              : 'idle',
        author: pullActor(pull.user?.login, pull.user?.type),
        reviewer: review?.reviewer,
        review: review?.review,
        runs: relatedRuns.slice(0, 8).map(runSource),
      };
    });
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
  const records = new Map<
    number,
    { state: AutomationState; comment: Comment }
  >();
  for (const comment of comments) {
    const state = readState(comment, region);
    const previous = state && records.get(state.issue);
    if (
      state &&
      (!previous ||
        Date.parse(comment.updated_at) >
          Date.parse(previous.comment.updated_at))
    ) {
      records.set(state.issue, { state, comment });
    }
  }

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
  return issues.map((issue) => {
    const issuePulls = pullsByIssue.get(issue.number) ?? [];
    const automation = runs.filter((run) => runIssue(run) === issue.number);
    const record = records.get(issue.number);
    const run = automation[0];
    const state =
      record &&
      (!run ||
        record.state.runId > run.id ||
        (record.state.runId === run.id &&
          (record.state.attempt ?? 1) >= run.run_attempt))
        ? record.state
        : undefined;
    const pull = issuePulls[0];
    const ci = runs.find(
      (candidate) =>
        candidate.path.split('@')[0] === '.github/workflows/ci.yml' &&
        candidate.head_sha === (pull?.head.sha ?? state?.head) &&
        (candidate.head_branch === pull?.head.ref ||
          candidate.pull_requests.some(
            ({ number }) => number === pull?.number,
          )),
    );
    const deployment = releases.find((release) =>
      issuePulls.some(
        (pr) =>
          pr.state === 'closed' &&
          pr.merge_commit_sha &&
          pr.merge_commit_sha === release.sha,
      ),
    );
    let reviewer: Agent | undefined;
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
    if (state?.reviewer === 'codex' || state?.reviewer === 'claude') {
      reviewer = state.reviewer;
    } else if (developer && region.slug === 'han41858/videx') {
      reviewer = 'claude';
    } else if (developer && region.slug === 'han41858/commit-trail') {
      reviewer = developer === 'codex' ? 'claude' : 'codex';
    }
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
    let detail = state?.detail;
    const outcome = run && runStage(run);
    if (
      run &&
      (outcome === 'failed' || outcome === 'attention') &&
      (!state || state.status !== 'needs_human') &&
      (!record || run.id >= record.state.runId) &&
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
    if (
      stage === 'idle' &&
      issue.state === 'closed' &&
      issue.state_reason === 'completed'
    )
      stage = 'complete';
    if (deployment && stage === 'complete') {
      ({ stage } = deployment);
      evidence = deployment;
      reason = deployment.status;
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

    return {
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      stage,
      state: issue.state,
      stateReason: issue.state_reason,
      subIssueCount: issue.sub_issues_summary?.total,
      parent: parents.get(issue.number),
      reason,
      detail,
      evidence,
      developer,
      reviewer,
      review,
      pulls: issuePulls.map((item) => ({
        number: item.number,
        title: item.title,
        url: item.html_url,
        status: item.draft && item.state === 'open' ? 'draft' : item.state,
      })),
      runs: [...automation, ...(ci ? [ci] : [])].slice(0, 8).map(runSource),
    };
  });
}
