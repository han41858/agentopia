import { branchIssueNumber } from './branch-roads.ts';
import type { Region, Pull, PullLinks, Run } from './model.ts';

export function pullIssue(pull: Pull, region: Region) {
  if (pull.head.repo?.full_name.toLowerCase() !== region.slug) return;
  return branchIssueNumber(pull.head.ref);
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

export function indexPulls(
  region: Region,
  pulls: Pull[],
  runs: Run[],
  links: ReadonlyMap<number, PullLinks>,
) {
  const byNumber = new Map(
    pulls.map((pull) => [
      pull.number,
      {
        issues: linkedPullIssues(pull, region, links.get(pull.number)),
        relatedRuns: [] as Run[],
        ciHistory: [] as Run[],
        ci: undefined as Run | undefined,
      },
    ]),
  );
  // Only infer association by ref and SHA for local branches.
  if (!pulls.length) return byNumber;
  const byHead = new Map<string, Pull[]>();
  const pullsByNumber = new Map(pulls.map((pull) => [pull.number, pull]));
  for (const pull of pulls) {
    if (pull.head.repo?.full_name.toLowerCase() !== region.slug) continue;
    const key = pull.head.ref + ':' + pull.head.sha;
    const group = byHead.get(key) ?? [];
    group.push(pull);
    byHead.set(key, group);
  }
  for (const run of runs) {
    const targets = run.pull_requests?.length
      ? [...new Set(run.pull_requests.map((ref) => ref.number))].map((number) =>
          pullsByNumber.get(number),
        )
      : (byHead.get(run.head_branch + ':' + run.head_sha) ?? []);
    for (const pull of targets) {
      if (!pull) continue;
      const entry = byNumber.get(pull.number)!;
      const current = run.head_sha === pull.head.sha;
      if (current) entry.relatedRuns.push(run);
      if (run.path.split('@')[0] === '.github/workflows/ci.yml') {
        entry.ciHistory.push(run);
        if (current) entry.ci ??= run;
      }
    }
  }
  return byNumber;
}
