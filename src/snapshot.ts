import type { Adventurer, Report, Stage } from '../server/model.ts';

export function reportForges(report?: Report) {
  return report?.forges ?? report?.pullQuests ?? [];
}

export type Snapshot = {
  report?: Report;
  error?: string;
  httpStatus?: number;
  pulses?: Record<string, number>;
};

export function partyStates(report: Report) {
  return new Map([
    ...report.quests.map((quest): [string, string] => [
      `issue-${quest.number}`,
      JSON.stringify([
        quest.state,
        quest.stateReason,
        quest.stage,
        quest.developer,
        quest.reviewer,
        quest.review,
        quest.victory,
        quest.adventurers,
        quest.activity,
        quest.reopened,
        quest.workPull,
        quest.reason,
        quest.pulls
          .map(({ number, status }) => [number, status])
          .sort((a, b) => Number(a[0]) - Number(b[0])),
      ]),
    ]),
    ...reportForges(report).map((pull): [string, string] => [
      `pr-${pull.number}`,
      JSON.stringify([
        pull.stage,
        pull.draft,
        pull.cancelled,
        pull.finishedAt,
        pull.author,
        pull.reviewer,
        pull.review,
        pull.activity,
        pull.issues,
        pull.quality,
        pull.ciParticipated,
        pull.adventurers,
      ]),
    ]),
  ]);
}

// A bounded refresh can omit earlier work. Only carry its participation
// forward; activity and failure always come from the current observation.
export function retainParticipants(
  current: Adventurer[] = [],
  previous: Adventurer[] = [],
) {
  const members = [...current];
  for (const prior of previous) {
    const index = members.findIndex((member) => member.agent === prior.agent);
    if (index < 0)
      members.push({ agent: prior.agent, roles: [...prior.roles] });
    else
      members[index] = {
        ...members[index],
        roles: [...new Set([...members[index].roles, ...prior.roles])],
      };
  }
  return members;
}

export function reportSnapshot(report: Report, previous?: Snapshot): Snapshot {
  if (!previous?.report) return { report };
  const oldReport = previous.report;
  const warnings = new Set(report.warnings);
  const missingPulls = warnings.has('PR') || warnings.has('열린 PR');
  const missingRuns = warnings.has('Actions') || warnings.has('AI 상태 기록');
  const missingLinks = warnings.has('PR 이슈 연결 및 리뷰');
  const missingDeployments = warnings.has('배포') || warnings.has('배포 상태');
  const prior = new Map(
    previous.report.quests.map((quest) => [quest.number, quest]),
  );
  const oldForges = new Map(
    reportForges(oldReport).map((pull) => [pull.number, pull]),
  );
  const freshForges = reportForges(report).map((pull) => ({
    ...pull,
    ciParticipated:
      pull.ciParticipated || oldForges.get(pull.number)?.ciParticipated,
    adventurers: retainParticipants(
      pull.adventurers,
      oldForges.get(pull.number)?.adventurers,
    ),
  }));
  report = {
    ...report,
    branchInventory: report.branchInventory ?? oldReport.branchInventory,
    branchPulls: missingPulls
      ? (oldReport.branchPulls ?? report.branchPulls)
      : report.branchPulls,
    releases:
      missingDeployments && !report.releases.length
        ? oldReport.releases
        : report.releases,
    forges: missingPulls
      ? [
          ...freshForges,
          ...reportForges(oldReport)
            .filter(
              (pull) =>
                !reportForges(report).some(
                  (fresh) => fresh.number === pull.number,
                ),
            )
            .map((pull) => ({
              ...pull,
              adventurers: pull.adventurers?.map(
                ({ active: _, ...member }) => member,
              ),
              stage: activeStages.has(pull.stage)
                ? ('idle' as const)
                : pull.stage,
              quality: pull.quality === 'ci' ? undefined : pull.quality,
            })),
        ]
      : freshForges,
    quests: report.quests.map((quest) => {
      const old = prior.get(quest.number);
      if (old && (missingPulls || missingRuns || missingLinks)) {
        const knownStage = quest.stage !== 'idle' && quest.stage !== 'returned';
        const sameState = quest.state === old.state;
        const adventurers = quest.adventurers?.length
          ? quest.adventurers
          : old.adventurers?.map(({ active: _, ...member }) => member);
        const oldPulls =
          missingPulls || missingLinks
            ? old.pulls.filter(
                (pull) =>
                  !quest.pulls.some((fresh) => fresh.number === pull.number),
              )
            : [];
        quest = {
          ...quest,
          pulls: [...quest.pulls, ...oldPulls],
          victory:
            quest.victory || ((missingPulls || missingLinks) && old.victory),
          activity:
            (missingPulls || missingLinks) && old.activity
              ? { ...old.activity, issueComments: quest.issueComments }
              : quest.activity,
          adventurers,
          ...(missingRuns && !knownStage && sameState
            ? {
                stage: activeStages.has(old.stage) ? 'idle' : old.stage,
                reason: old.reason,
                evidence: old.evidence,
                runs: old.runs,
              }
            : {}),
        };
      }
      quest = {
        ...quest,
        adventurers: retainParticipants(quest.adventurers, old?.adventurers),
      };
      return quest.state === 'open' &&
        !quest.reopened &&
        (old?.state === 'closed' || old?.reopened)
        ? { ...quest, reopened: true }
        : quest;
    }),
  };
  const priorStates = partyStates(previous.report);
  const pulses: Record<string, number> = {};
  for (const [key, state] of partyStates(report)) {
    const pulse = previous.pulses?.[key] ?? 0;
    const next = pulse + Number(priorStates.get(key) !== state);
    if (next) pulses[key] = next;
  }
  return { report, pulses };
}

export const activeStages = new Set<Stage>([
  'queued',
  'developing',
  'revising',
  'reviewing',
  'ci',
  'deploying',
  'merging',
]);

export const alerts = new Set<Stage>(['failed', 'attention']);
