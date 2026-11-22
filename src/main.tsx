import { objectSizes, heritageSize } from './object-sizes.ts';
import { heritageTier } from './heritage-scale.ts';
import { WorldArt } from './world-art.tsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ClipboardCheck,
  GitCommitHorizontal,
  MessageCircle,
  Check,
  ChevronRight,
  Clock3,
  ExternalLink,
  Trash2,
  Flag,
  GitPullRequest,
  Hourglass,
  KeyRound,
  Plus,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Swords,
  Skull,
  Trophy,
  DoorOpen,
  Ticket,
  X,
} from 'lucide-react';
import {
  repositoryInput,
  repositoryOwner,
  repositoryRegion,
  repositorySlug,
  stages,
} from '../server/model.ts';
import type {
  Adventurer,
  ActivityCounts,
  ActivityKind,
  ActivityPage,
  PullQuest,
  Quest,
  Region,
  Report,
  Repository,
  RepositoryPage,
  Source,
  Stage,
} from '../server/model.ts';
import {
  AdventurerGlyph,
  AdventurerParty,
  PartyLeaderGlyph,
  PortalKeeperGlyph,
  agentNames,
  MonsterGlyph,
  partyLabel,
  partyLeaderLabel,
} from './characters.tsx';
import { summarizeActivity } from '../server/activity.ts';
import type {
  ActivityProfile,
  Discussion,
  PullActivity,
} from '../server/activity.ts';
import { ActivityAura, ReviewOpinionBadge } from './activity-effects.tsx';
import { nextRefreshInterval, refreshDue } from './refresh.ts';
import { facilities, FacilityGlyph } from './facility-art.tsx';
import { facilityKind, isCurrentFacility } from './facility-kind.ts';
import { HeritageArc, heritageBuildings } from './heritage-arc.tsx';
import type {
  Heritage,
  HeritageMetric,
  HeritageRecord,
} from '../server/heritage.ts';
import { GitHubUsage, publishGitHubUsage } from './github-usage.tsx';
import { KingdomWall } from './kingdom-wall.tsx';
import type {
  GitHubDebugSnapshot,
  RefreshConsumption,
} from '../server/github-debug.ts';
import { BranchRoadMap, placeBranchRoads } from './branch-road-map.tsx';
import type { RoadSelection } from './branch-road-map.tsx';
import './styles.css';

function reportForges(report?: Report) {
  return report?.forges ?? report?.pullQuests ?? [];
}

type Snapshot = {
  report?: Report;
  error?: string;
  httpStatus?: number;
  pulses?: Record<string, number>;
};

function partyStates(report: Report) {
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
function retainParticipants(
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

function reportSnapshot(report: Report, previous?: Snapshot): Snapshot {
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

function getTokenStatus(
  hasData: boolean,
  hasRepositories: boolean,
  snapshot?: Snapshot,
) {
  if (snapshot?.error) {
    const labels: Partial<Record<number, string>> = {
      400: '토큰 형식 오류',
      401: '토큰 인증 실패',
      403: '토큰 권한·한도 확인',
      404: '저장소 접근 확인 필요',
      429: 'GitHub 요청 한도 도달',
    };
    return {
      label: labels[snapshot.httpStatus ?? 0] ?? '토큰 상태 확인 불가',
      description: snapshot.error,
      tone: 'warning',
    };
  }
  if (hasData)
    return {
      label: '토큰 접근 확인됨',
      description: '이 토큰으로 GitHub 저장소의 이슈를 조회했습니다.',
      tone: 'verified',
    };
  if (!hasRepositories)
    return {
      label: '저장소 접근 확인 전',
      description: '저장소를 추가하면 이 토큰의 접근 권한을 확인합니다.',
      tone: 'checking',
    };
  return {
    label: '토큰 확인 중',
    description: 'GitHub에서 토큰의 저장소 접근을 확인하고 있습니다.',
    tone: 'checking',
  };
}
const activeStages = new Set<Stage>([
  'queued',
  'developing',
  'revising',
  'reviewing',
  'ci',
  'deploying',
  'merging',
]);
const alerts = new Set<Stage>(['failed', 'attention']);
const initialRepositories: Repository[] = [
  { slug: 'han41858/agentopia', private: false },
];
const legacyRepositoryListKey = 'agentopia.public-repositories';
const settingsVersion = 2;
const settingsKey = 'agentopia.github-settings';
type GitHubSettings = { token: string; repositories: Repository[] };

function kingdomHue(slug: string) {
  let hash = 2166136261;
  for (const character of slug.toLowerCase()) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return ((hash >>> 0) % 36_000) / 100;
}

function readSettings(): GitHubSettings {
  try {
    const saved = localStorage.getItem(settingsKey);
    const stored: unknown = JSON.parse(saved ?? 'null');
    const settings = stored && typeof stored === 'object' ? stored : {};
    const token =
      'token' in settings && typeof settings.token === 'string'
        ? settings.token
        : '';
    const list: unknown =
      saved === null
        ? JSON.parse(localStorage.getItem(legacyRepositoryListKey) ?? '[]')
        : 'repositories' in settings
          ? settings.repositories
          : [];
    const needsMigration =
      !('version' in settings) || settings.version !== settingsVersion;
    const repositories = new Map<string, Repository>(
      needsMigration
        ? initialRepositories.map((repo) => [repo.slug, repo])
        : [],
    );
    if (Array.isArray(list)) {
      for (const item of list as unknown[]) {
        const repo = typeof item === 'object' && item !== null ? item : {};
        const candidate =
          saved === null ? item : 'slug' in repo ? repo.slug : undefined;
        const slug =
          typeof candidate === 'string' ? repositorySlug(candidate) : undefined;
        const restricted = 'private' in repo && repo.private === true;
        if (slug && (!restricted || token))
          repositories.set(slug, { slug, private: restricted });
      }
    }
    return { token, repositories: [...repositories.values()] };
  } catch {
    return { token: '', repositories: initialRepositories };
  }
}
const glyph = {
  idle: Clock3,
  queued: Hourglass,
  developing: Swords,
  revising: RotateCcw,
  reviewing: ScrollText,
  ci: PartyLeaderGlyph,
  deploying: PortalKeeperGlyph,
  merging: GitPullRequest,
  complete: Trophy,
  returned: DoorOpen,
  failed: Skull,
  attention: Flag,
};

function monsterRest(quest: Quest) {
  if (
    quest.stage === 'returned' ||
    quest.stage === 'complete' ||
    quest.state === 'closed'
  )
    return '귀환';
  return '대기';
}

function MonsterMarker({
  quest,
  boss,
  open,
  pulse,
  inspected,
  related,
  inspect,
}: {
  quest: Quest;
  boss: boolean;
  open: () => void;
  pulse?: number;
  inspected: boolean;
  related: boolean;
  inspect: (active: boolean) => void;
}) {
  const defeated = quest.state === 'closed';
  const members = quest.adventurers ?? [];
  const resting = monsterRest(quest);
  const status = [
    defeated
      ? '몬스터 처치 완료'
      : quest.reopened
        ? '몬스터 부활'
        : '몬스터 출현',
    quest.stage !== 'idle' && quest.stage !== 'complete'
      ? stages[quest.stage]
      : undefined,
    quest.victory ? '제작 결과 반영' : undefined,
    quest.stage === 'failed' ? '구조 요청' : undefined,
    ...members.map((member) => partyLabel(member, resting)),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      data-road-issue={quest.number}
      className={`expedition monster-marker${boss ? ' boss-marker' : ''}${alerts.has(quest.stage) ? ' blocked' : ''}${defeated ? ' closed-issue' : ''}`}
      aria-label={`이슈 #${quest.number} · ${quest.title} · ${status}${activityEffectsLabel(quest.activity)}`}
      title={`${quest.title} · ${status}`}
      onClick={open}
      data-highlight={inspected ? 'selected' : related ? 'related' : undefined}
      onPointerEnter={() => inspect(true)}
      onPointerLeave={() => inspect(false)}
      onFocus={() => inspect(true)}
      onBlur={() => inspect(false)}
    >
      {pulse !== undefined && (
        <span key={pulse} className="party-pulse" aria-hidden="true" />
      )}
      <ActivityAura
        activity={
          quest.activity && {
            ...quest.activity,
            reviews: undefined,
            opinion: undefined,
          }
        }
      >
        <MonsterGlyph
          boss={boss}
          defeated={defeated}
          reopened={quest.reopened}
          commits={quest.activity?.commits}
        />
      </ActivityAura>
      <small className="expedition-number">{`#${quest.number}`}</small>
      <AdventurerParty members={members} resting={resting} />
      <MonsterStatusIcons quest={quest} hideCombat />
    </button>
  );
}

function MonsterStatusIcons({
  quest,
  hideCombat = false,
}: {
  quest: Quest;
  hideCombat?: boolean;
}) {
  const StageIcon = glyph[quest.stage];
  return (
    <span className="monster-statuses" aria-hidden="true">
      {quest.state === 'closed' && <Check size={12} />}
      {quest.victory && <Trophy size={12} />}
      {quest.stage !== 'idle' &&
        quest.stage !== 'complete' &&
        !(
          hideCombat &&
          (quest.stage === 'developing' || quest.stage === 'revising')
        ) && <StageIcon size={12} />}
    </span>
  );
}

const activityKinds = ['commits', 'comments', 'reviews'] as const;
const activityDisplay = {
  commits: { Icon: GitCommitHorizontal, label: '커밋' },
  comments: { Icon: MessageCircle, label: '댓글' },
  reviews: { Icon: ClipboardCheck, label: '리뷰' },
};

function activityEffectsLabel(activity?: ActivityProfile) {
  return activity?.opinion?.state === 'APPROVED'
    ? ' · 리뷰 승인'
    : activity?.opinion?.state === 'CHANGES_REQUESTED'
      ? ' · 수정 요청'
      : '';
}

function pullStatus(pull: PullQuest) {
  if (pull.cancelled) return '시설 작업 취소';
  switch (pull.stage) {
    case 'developing':
      return '제작 중';
    case 'revising':
      return '재제련 중';
    case 'reviewing':
      return '장비 검수 중';
    case 'ci':
      return '품질 시험';
    case 'merging':
      return '제작 결과 반영 중';
    case 'complete':
      return '시설 완성';
    case 'idle':
      break;
    default:
      return stages[pull.stage];
  }
  return pull.draft ? '초안' : 'PR 열림';
}

function pullActivity(pull: PullQuest) {
  if (pull.reviewer) return `${agentNames[pull.reviewer]} 리뷰 기록`;
  if (pull.author) return `${agentNames[pull.author]} 작성`;
  return undefined;
}

function partyLeaderState(pull: PullQuest) {
  if (pull.quality === 'ci' || pull.stage === 'ci') return 'active';
  if (pull.ciParticipated) return 'resting';
}

function FacilityMarker({
  pull,
  open,
  pulse,
  inspected,
  related,
  inspect,
}: {
  pull: PullQuest;
  open: () => void;
  pulse?: number;
  inspected: boolean;
  related: boolean;
  inspect: (active: boolean) => void;
}) {
  const kind = facilityKind(pull.title);
  const { name, Tool } = facilities[kind];
  const working = pull.stage === 'developing' || pull.stage === 'revising';
  const reviewing = pull.stage === 'reviewing';
  const members = pull.adventurers ?? [];
  const activeMembers = members.filter(
    (member) => member.active && !member.fallen,
  );
  const leader = partyLeaderState(pull);
  const label = [
    `${name} PR #${pull.number}`,
    pull.title,
    pullActivity(pull),
    pullStatus(pull),
    leader && partyLeaderLabel(leader),
    ...members.map((member) => partyLabel(member, '대기')),
    ...(pull.issues ?? []).map((number) => `이슈 #${number}`),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      className={`expedition pull-marker facility-marker${alerts.has(pull.stage) ? ' blocked' : ''}`}
      data-highlight={inspected ? 'selected' : related ? 'related' : undefined}
      data-stage={pull.stage}
      data-facility={kind}
      title={label}
      aria-label={`${label}${activityEffectsLabel(pull.activity)}`}
      onClick={open}
      onPointerEnter={() => inspect(true)}
      onPointerLeave={() => inspect(false)}
      onFocus={() => inspect(true)}
      onBlur={() => inspect(false)}
    >
      {pulse !== undefined && (
        <span key={pulse} className="party-pulse" aria-hidden="true" />
      )}
      <ActivityAura activity={pull.activity} facility>
        <span
          className="facility-core"
          data-draft={pull.draft}
          aria-hidden="true"
        >
          <FacilityGlyph kind={kind} />
          <ReviewOpinionBadge opinion={pull.activity?.opinion?.state} />
          {!activeMembers.length && working && (
            <Tool className="facility-tool" size={13} />
          )}
          {!activeMembers.length && reviewing && (
            <ScrollText className="facility-tool" size={13} />
          )}
          {pull.stage === 'merging' && (
            <GitPullRequest className="facility-result" size={13} />
          )}
          {alerts.has(pull.stage) && (
            <Skull className="facility-result" size={13} />
          )}
        </span>
      </ActivityAura>
      <small className="expedition-number">{`PR #${pull.number}`}</small>
      <AdventurerParty members={members} leader={leader} resting="대기" forge />
    </button>
  );
}

function KingdomMonsters({
  quests,
  issueOrder,
  pulses,
  label,
  openQuest,
  highlight,
  related,
  inspect,
}: {
  quests: Quest[];
  issueOrder: Map<number, number>;
  pulses?: Record<string, number>;
  label: string;
  openQuest: (quest: Quest) => void;
  highlight?: number;
  related: ReadonlySet<number>;
  inspect: (number: number, active: boolean) => void;
}) {
  const openQuests = quests.filter((quest) => quest.state === 'open');
  const visible = new Set(openQuests.map(({ number }) => number));
  const childrenByParent = new Map<number, Quest[]>();
  for (const quest of quests) {
    if (quest.parent === undefined) continue;
    const siblings = childrenByParent.get(quest.parent) ?? [];
    siblings.push(quest);
    childrenByParent.set(quest.parent, siblings);
  }

  const priority = (quest: Quest) =>
    alerts.has(quest.stage) ? 2 : activeStages.has(quest.stage) ? 1 : 0;
  const comparePriority = (a: Quest, b: Quest) =>
    (issueOrder.get(a.number) ?? Infinity) -
      (issueOrder.get(b.number) ?? Infinity) || priority(b) - priority(a);
  const roots = openQuests
    .filter(({ parent }) => parent === undefined || !visible.has(parent))
    .sort(comparePriority);

  function render(quest: Quest) {
    const children = (childrenByParent.get(quest.number) ?? []).filter(
      ({ number }) => visible.has(number),
    );
    children.sort(comparePriority);
    const boss =
      childrenByParent.has(quest.number) || Boolean(quest.subIssueCount);
    return (
      <li
        key={quest.number}
        className={children.length ? 'guild-branch' : undefined}
      >
        <MonsterMarker
          quest={quest}
          boss={boss}
          open={() => openQuest(quest)}
          pulse={pulses?.[`issue-${quest.number}`]}
          inspected={highlight === quest.number}
          related={related.has(quest.number)}
          inspect={(active) => inspect(quest.number, active)}
        />
        {children.length > 0 && (
          <ul
            className="guild-parties"
            aria-label={`이슈 #${quest.number}의 하위 이슈`}
          >
            {children.map(render)}
          </ul>
        )}
      </li>
    );
  }

  if (!roots.length) return null;
  return (
    <div className="kingdom-fields">
      <ul className="expeditions" aria-label={label}>
        {roots.map(render)}
      </ul>
    </div>
  );
}

class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(
  params: URLSearchParams,
  token: string,
  signal: AbortSignal,
  onUsage?: (usage?: RefreshConsumption) => void,
): Promise<T> {
  const response = await fetch(`/api/github?${params}`, {
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const header = response.headers.get('X-Agentopia-GitHub-Usage');
  let snapshot: GitHubDebugSnapshot | undefined;
  if (header) {
    try {
      snapshot = JSON.parse(header) as GitHubDebugSnapshot;
    } catch {
      // Invalid diagnostics should not interrupt repository updates.
    }
  }
  if (!signal.aborted) {
    publishGitHubUsage(token, snapshot);
    onUsage?.(snapshot?.refresh);
  }
  const body = await response.json();
  if (!response.ok)
    throw new RequestError(
      body.error ?? 'GitHub 동기화에 실패했습니다.',
      response.status,
    );
  return body as T;
}

function requestHeritage(slug: string, token: string, signal: AbortSignal) {
  return request<Heritage>(
    new URLSearchParams({ repo: slug, heritage: '1' }),
    token,
    signal,
  );
}

function Badge({ stage, label }: { stage: Stage; label?: string }) {
  const Icon = glyph[stage];
  const description =
    label ?? (stage === 'ci' ? `GitHub Actions · ${stages.ci}` : stages[stage]);
  if (alerts.has(stage) || stage === 'complete' || stage === 'ci') {
    return (
      <span className={`badge ${stage}`} role="img" aria-label={description}>
        <Icon size={14} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={`badge ${stage}`}>
      <Icon size={14} aria-hidden="true" />
      {description}
    </span>
  );
}

function IssueBadge({
  quest,
  showOutcome = true,
}: {
  quest: Quest;
  showOutcome?: boolean;
}) {
  return (
    <span className="monster-statuses">
      {showOutcome && quest.state === 'closed' && (
        <span
          className="badge complete"
          role="img"
          aria-label="몬스터 처치 완료"
        >
          <Check size={14} aria-hidden="true" />
        </span>
      )}
      {showOutcome && quest.victory && (
        <Badge stage="complete" label="제작 결과 반영" />
      )}
      {quest.stage !== 'idle' && quest.stage !== 'complete' ? (
        <Badge stage={quest.stage} />
      ) : quest.state === 'open' && !quest.victory ? (
        <span className="badge idle">몬스터 출현</span>
      ) : null}
    </span>
  );
}

const releaseTime = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  hour12: false,
  timeZone: 'Asia/Seoul',
});

function OutLink({ item }: { item: Source }) {
  return (
    <a className="source" href={item.url} target="_blank" rel="noreferrer">
      <span>
        {item.title}
        {item.status && <small>{item.status}</small>}
      </span>
      <ExternalLink size={14} />
    </a>
  );
}

function ResultLink({ item }: { item: Source }) {
  return (
    <a
      className="source result-link"
      title={item.title}
      href={item.url}
      target="_blank"
      rel="noreferrer"
    >
      <span>{item.title}</span>
      {item.status && <small>{item.status}</small>}
      <ExternalLink size={14} aria-hidden="true" />
    </a>
  );
}

function Dialog({
  title,
  titleHref,
  showLinkIcon = true,
  titleIcon,
  headingActions,
  className,
  children,
  close,
}: {
  title: string;
  titleHref?: string;
  showLinkIcon?: boolean;
  titleIcon?: ReactNode;
  headingActions?: ReactNode;
  className?: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef<number | null>(null);
  const releasedBackdrop = useRef(false);

  function isBackdrop(event: {
    currentTarget: HTMLDialogElement;
    target: EventTarget;
    clientX: number;
    clientY: number;
  }) {
    const box = event.currentTarget.getBoundingClientRect();
    return (
      event.target === event.currentTarget &&
      (event.clientX < box.left ||
        event.clientX >= box.right ||
        event.clientY < box.top ||
        event.clientY >= box.bottom)
    );
  }

  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={className ? `panel dialog ${className}` : 'panel dialog'}
      aria-label={title}
      onCancel={close}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        pressedBackdrop.current = isBackdrop(event) ? event.pointerId : null;
        releasedBackdrop.current = false;
      }}
      onPointerUp={(event) => {
        if (event.isPrimary)
          releasedBackdrop.current =
            pressedBackdrop.current === event.pointerId && isBackdrop(event);
      }}
      onPointerCancel={(event) => {
        if (event.isPrimary) {
          pressedBackdrop.current = null;
          releasedBackdrop.current = false;
        }
      }}
      onClick={(event) => {
        const dismiss = releasedBackdrop.current && isBackdrop(event);
        pressedBackdrop.current = null;
        releasedBackdrop.current = false;
        if (dismiss) close();
      }}
    >
      <div className="dialog-heading">
        <h2>
          {titleHref ? (
            <a
              className="dialog-title-link"
              href={titleHref}
              target="_blank"
              rel="noreferrer"
            >
              {titleIcon}
              {title}
              {showLinkIcon && <ExternalLink size={15} aria-hidden="true" />}
            </a>
          ) : (
            title
          )}
        </h2>
        {headingActions}
        <button className="icon-button" aria-label="닫기" onClick={close}>
          <X size={20} />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}

type BrowserProps = {
  region: string;
  number: number;
  token: string;
  kinds?: readonly ActivityKind[];
  counts?: ActivityCounts;
};

function useActivityBrowser(
  { region, number, token, kinds = activityKinds, counts }: BrowserProps,
  partialCommits = false,
) {
  const [selected, setSelected] = useState<ActivityKind>();
  const [visited, setVisited] = useState<ActivityKind[]>([]);
  const counters = (
    <div className="activity-counters">
      {kinds.map((kind) => {
        const { Icon, label } = activityDisplay[kind];
        const count = counts?.[kind];
        const value =
          count === undefined
            ? '—'
            : `${count}${kind === 'commits' && partialCommits ? '+' : ''}`;
        return (
          <button
            key={kind}
            type="button"
            className="text-button activity-counter"
            title={label}
            aria-label={
              count === undefined
                ? label
                : `${label} ${count}개${kind === 'commits' && partialCommits ? ' 이상' : ''}`
            }
            aria-expanded={selected === kind}
            onClick={() => {
              if (!visited.includes(kind)) setVisited([...visited, kind]);
              setSelected(selected === kind ? undefined : kind);
            }}
          >
            <Icon size={16} aria-hidden="true" />
            {value}
          </button>
        );
      })}
    </div>
  );
  const entries = visited.map((kind) => (
    <div key={kind} hidden={selected !== kind}>
      <ActivityEntries
        region={region}
        number={number}
        kind={kind}
        token={token}
      />
    </div>
  ));
  return { counters, entries };
}

function ActivityBrowser(props: BrowserProps) {
  const { counters, entries } = useActivityBrowser(props);
  return (
    <div className="activity-browser">
      {counters}
      {entries}
    </div>
  );
}

function ActivityEntries({
  region,
  number,
  kind,
  token,
}: {
  region: string;
  number: number;
  kind: ActivityKind;
  token: string;
}) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ActivityPage>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    request<ActivityPage>(
      new URLSearchParams({
        repo: region,
        activity: kind,
        number: String(number),
        page: String(page),
      }),
      token,
      controller.signal,
    ).then(
      (data) => {
        if (!controller.signal.aborted) {
          setResult((previous) => ({
            entries:
              page === 1
                ? data.entries
                : [...(previous?.entries ?? []), ...data.entries],
            next: data.next,
          }));
        }
      },
      (cause: Error) => {
        if (!controller.signal.aborted) setError(cause.message);
      },
    );
    return () => controller.abort();
  }, [region, number, kind, page, token]);
  if (error) return <p className="fetch-error">{error}</p>;
  if (!result) return <p role="status">GitHub 기록 조회 중…</p>;
  return (
    <div className="activity-entries">
      {!result.entries.length && <p>GitHub 기록이 없습니다.</p>}
      {result.entries.map((item) => (
        <div className="activity-entry" key={item.url}>
          <OutLink item={item} />
          {(item.author || item.at) && (
            <small>
              {[
                item.author,
                item.at && new Date(item.at).toLocaleString('ko-KR'),
              ]
                .filter(Boolean)
                .join(' · ')}
            </small>
          )}
          {item.body && <p>{item.body}</p>}
        </div>
      ))}
      {result.next && (
        <button
          type="button"
          className="text-button"
          disabled={page === result.next}
          onClick={() => setPage(result.next ?? page)}
        >
          더 보기
        </button>
      )}
    </div>
  );
}

type ActivitySummaryProps = {
  region: string;
  token: string;
  issue?: number;
  pulls: string;
  initial?: ActivityProfile;
};

function useActivitySummary({
  region,
  token,
  issue,
  pulls,
  initial,
}: ActivitySummaryProps) {
  const [loaded, setLoaded] = useState<ActivityProfile>();
  const [failed, setFailed] = useState(false);
  const needsDetails =
    !initial ||
    initial.partialCommits ||
    initial.commits === undefined ||
    initial.pullComments === undefined ||
    initial.reviews === undefined ||
    (issue !== undefined && initial.issueComments === undefined);
  useEffect(() => {
    if (!needsDetails) return;
    const controller = new AbortController();
    const get = <T,>(summary: string, number: string) =>
      request<T>(
        new URLSearchParams({ repo: region, summary, number }),
        token,
        controller.signal,
      );
    async function load() {
      const issueRecord =
        issue === undefined
          ? undefined
          : await get<Discussion>('issue', String(issue));
      const numbers = pulls ? pulls.split(',') : [];
      const records: PullActivity[] = [];
      for (let offset = 0; offset < numbers.length; offset += 3) {
        records.push(
          ...(await Promise.all(
            numbers
              .slice(offset, offset + 3)
              .map((number) => get<PullActivity>('pull', number)),
          )),
        );
      }
      if (!controller.signal.aborted)
        setLoaded(summarizeActivity(issueRecord, records));
    }
    void load().catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [region, token, issue, pulls, needsDetails]);
  const status =
    needsDetails && !loaded
      ? failed
        ? '일부 활동을 조회하지 못했습니다.'
        : 'GitHub 활동 집계 확인 중…'
      : undefined;
  return { activity: loaded ?? initial, status };
}

function ActivityTotals(props: ActivitySummaryProps) {
  const { activity, status } = useActivitySummary(props);
  const { issue } = props;
  const rows = [
    ['고유 커밋', activity?.commits, activity?.partialCommits],
    ...(issue === undefined
      ? []
      : ([['이슈 댓글', activity?.issueComments, false]] as const)),
    ['PR 댓글', activity?.pullComments, false],
    ['리뷰', activity?.reviews, false],
  ] as const;
  return (
    <section className="activity-totals">
      <h4>GitHub 활동량</h4>
      <dl>
        {rows.map(([label, count, partial]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {typeof count === 'number'
                ? `${count.toLocaleString('ko-KR')}${partial ? ' 이상' : ''}`
                : '미확인'}
            </dd>
          </div>
        ))}
      </dl>
      {status && <small role="status">{status}</small>}
    </section>
  );
}

function QuestDetail({
  quest,
  region,
  token,
  close,
}: {
  quest: Quest;
  region: Region;
  token: string;
  close: () => void;
}) {
  const [activityPull, setActivityPull] = useState<number>();
  const [visitedPulls, setVisitedPulls] = useState<number[]>([]);
  return (
    <Dialog title={`이슈 #${quest.number}`} titleHref={quest.url} close={close}>
      <h3>{quest.title}</h3>
      <div className="battle-scene">
        {(['codex', 'claude'] as const).map((agent) => {
          const member = quest.adventurers?.find(
            (item) => item.agent === agent,
          );
          return (
            member && (
              <div
                className={`battle-adventurer ${agent}`}
                key={agent}
                title={partyLabel(member, monsterRest(quest))}
                aria-label={partyLabel(member, monsterRest(quest))}
              >
                <AdventurerGlyph
                  agent={agent}
                  active={member.active}
                  fallen={member.fallen}
                />
              </div>
            )
          );
        })}
        <div className="battle-monster">
          <ActivityAura activity={quest.activity}>
            <MonsterGlyph
              boss={Boolean(quest.subIssueCount)}
              defeated={quest.state === 'closed'}
              reopened={quest.reopened}
              commits={quest.activity?.commits}
            />
          </ActivityAura>
          <small className="expedition-number">{`#${quest.number}`}</small>
          <MonsterStatusIcons quest={quest} />
        </div>
      </div>
      <ActivityTotals
        key={`${region.slug}:${quest.number}:${quest.pulls.map(({ number }) => number).join(',')}`}
        region={region.slug}
        token={token}
        issue={quest.number}
        pulls={quest.pulls.map(({ number }) => number).join(',')}
        initial={quest.activity}
      />
      <IssueBadge quest={quest} />
      {quest.stateReason === 'not_planned' && (
        <p>GitHub 종료 사유 · 작업하지 않기로 함</p>
      )}
      {quest.stateReason === 'duplicate' && <p>GitHub 종료 사유 · 중복</p>}
      {(quest.reason || quest.detail) && (
        <div className={`reason ${alerts.has(quest.stage) ? 'danger' : ''}`}>
          <p>{quest.reason}</p>
          {quest.detail && <p>{quest.detail}</p>}
        </div>
      )}
      {quest.evidence && <OutLink item={quest.evidence} />}
      {Boolean(quest.adventurers?.length) && (
        <>
          <h4>모험가 파티</h4>
          <AdventurerParty
            members={quest.adventurers ?? []}
            resting={monsterRest(quest)}
            detailed
          />
        </>
      )}
      {quest.review && (
        <p>
          현재 커밋의 AI 리뷰 결과 <strong>{quest.review}</strong>
        </p>
      )}
      <ActivityBrowser
        region={region.slug}
        number={quest.number}
        token={token}
        kinds={['comments']}
        counts={{ comments: quest.issueComments }}
      />
      {(quest.pulls.length > 0 || quest.commit) && <h4>공략 결과</h4>}
      {quest.commit && <ResultLink item={quest.commit} />}
      {quest.pulls.map((item) => (
        <div key={item.number}>
          <div className="result-row">
            <ResultLink
              item={{ ...item, title: `PR #${item.number} · ${item.title}` }}
            />
            <button
              className="text-button result-review"
              title={
                activityPull === item.number ? 'PR 활동 접기' : 'PR 활동 보기'
              }
              aria-label={
                activityPull === item.number ? 'PR 활동 접기' : 'PR 활동 보기'
              }
              aria-expanded={activityPull === item.number}
              onClick={() => {
                if (!visitedPulls.includes(item.number))
                  setVisitedPulls([...visitedPulls, item.number]);
                setActivityPull(
                  activityPull === item.number ? undefined : item.number,
                );
              }}
            >
              <GitPullRequest size={16} aria-hidden="true" />
            </button>
          </div>
          {visitedPulls.includes(item.number) && (
            <div hidden={activityPull !== item.number}>
              <ActivityBrowser
                key={item.number}
                region={region.slug}
                number={item.number}
                counts={item.activities}
                token={token}
              />
            </div>
          )}
        </div>
      ))}
      {quest.runs.length > 0 && <h4>GitHub Actions</h4>}
      {quest.runs.map((item) => (
        <OutLink key={item.url} item={item} />
      ))}
    </Dialog>
  );
}

function PullDetail({
  pull,
  region,
  token,
  close,
  openIssue,
}: {
  pull: PullQuest;
  region: Region;
  token: string;
  close: () => void;
  openIssue: (number: number) => boolean;
}) {
  const kind = facilityKind(pull.title);
  const iconLabel = facilities[kind].name + (pull.draft ? ' · 초안 PR' : '');
  const author = pull.author && agentNames[pull.author];
  const reviewer = pull.reviewer && agentNames[pull.reviewer];
  const { activity, status } = useActivitySummary({
    region: region.slug,
    token,
    pulls: String(pull.number),
    initial: pull.activity,
  });
  const { counters, entries } = useActivityBrowser(
    {
      region: region.slug,
      number: pull.number,
      token,
      counts: {
        commits: activity?.partialCommits
          ? (pull.activities?.commits ?? activity.commits)
          : (activity?.commits ?? pull.activities?.commits),
        comments: activity?.pullComments ?? pull.activities?.comments,
        reviews: activity?.reviews ?? pull.activities?.reviews,
      },
    },
    activity?.partialCommits && pull.activities?.commits === undefined,
  );
  return (
    <Dialog
      className={pull.draft ? 'pull-dialog draft' : 'pull-dialog'}
      title={`PR #${pull.number}`}
      titleHref={pull.url}
      showLinkIcon={false}
      titleIcon={
        <span role="img" aria-label={iconLabel} title={iconLabel}>
          <FacilityGlyph kind={kind} />
        </span>
      }
      headingActions={counters}
      close={close}
    >
      <h3>{pull.title}</h3>
      <PullStatus pull={pull} />
      {status && <small role="status">{status}</small>}
      {entries}
      <AdventurerParty
        members={pull.adventurers ?? []}
        leader={partyLeaderState(pull)}
        resting="대기"
        detailed
        forge
      />
      {!!pull.issues?.length && (
        <ul className="facility-issues" aria-label="연결된 이슈">
          {pull.issues.map((number) => (
            <li key={number}>
              <a
                className="text-button"
                href={`https://github.com/${region.slug}/issues/${number}`}
                onClick={(event) => {
                  if (
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey &&
                    openIssue(number)
                  )
                    event.preventDefault();
                }}
              >
                이슈 #{number}
              </a>
            </li>
          ))}
        </ul>
      )}
      {author && <p>작성 · {author}</p>}
      {reviewer && (
        <p>
          리뷰 기록 · {reviewer} {pull.review}
        </p>
      )}
      {pull.runs.map((run) => (
        <OutLink key={run.url} item={run} />
      ))}
    </Dialog>
  );
}

function PullStatus({ pull }: { pull: PullQuest }) {
  if (pull.cancelled)
    return (
      <span className="badge idle">
        <X size={14} aria-hidden="true" /> 작업 취소
      </span>
    );
  if (pull.stage === 'idle') return null;
  return alerts.has(pull.stage) ||
    pull.stage === 'ci' ||
    pull.stage === 'complete' ? (
    <Badge stage={pull.stage} label={pullStatus(pull)} />
  ) : (
    <span className={`badge ${pull.stage}`}>{pullStatus(pull)}</span>
  );
}

function FacilityRows({
  entries,
  openPull,
}: {
  entries: PullQuest[];
  openPull: (pull: PullQuest) => void;
}) {
  return (
    <ul className="quest-tree">
      {entries.map((pull) => {
        const kind = facilityKind(pull.title);
        return (
          <li key={pull.number}>
            <button className="quest-row" onClick={() => openPull(pull)}>
              <span
                role="img"
                aria-label={facilities[kind].name}
                title={facilities[kind].name}
              >
                <FacilityGlyph kind={kind} />
              </span>
              <span className="quest-row-title">
                <small>PR #{pull.number}</small>
                <strong>{pull.title}</strong>
              </span>
              {!pull.merged && <PullStatus pull={pull} />}
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function PlazaDetail({
  region,
  pulls,
  openPull,
  close,
}: {
  region: Region;
  pulls: PullQuest[];
  openPull: (pull: PullQuest) => void;
  close: () => void;
}) {
  const current = pulls.filter(isCurrentFacility);
  const facilityHistory = pulls
    .filter((pull) => !isCurrentFacility(pull))
    .sort((left, right) =>
      (right.finishedAt ?? '').localeCompare(left.finishedAt ?? ''),
    );
  return (
    <Dialog title="개발 광장" close={close}>
      <h4>작업중</h4>
      {current.length ? (
        <FacilityRows entries={current} openPull={openPull} />
      ) : (
        <p>조회된 열린 PR이 없습니다.</p>
      )}
      {facilityHistory.length > 0 && (
        <details className="facility-history">
          <summary>시설 이력</summary>
          <FacilityRows entries={facilityHistory} openPull={openPull} />
          <OutLink
            item={{
              title: 'GitHub에서 종료된 PR 보기',
              url: `https://github.com/${region.slug}/pulls?q=is%3Apr+is%3Aclosed`,
            }}
          />
        </details>
      )}
    </Dialog>
  );
}

function RegionDetail({
  region,
  snapshot,
  openQuest,
  openWork,
  remove,
  close,
}: {
  region: Region;
  snapshot?: Snapshot;
  openQuest: (quest: Quest) => void;
  openWork?: () => void;
  remove: () => void;
  close: () => void;
}) {
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const quests = snapshot?.report?.quests ?? [];
  const known = new Set(quests.map((quest) => quest.number));
  const roots = quests.filter(
    (quest) => !quest.parent || !known.has(quest.parent),
  );
  const ordered = [...roots].sort(
    (a, b) =>
      Number(alerts.has(b.stage)) - Number(alerts.has(a.stage)) ||
      Number(activeStages.has(b.stage)) - Number(activeStages.has(a.stage)) ||
      b.number - a.number,
  );
  function render(quest: Quest, ancestry: number[] = []) {
    const children = quests.filter(
      (child) =>
        child.parent === quest.number && !ancestry.includes(child.number),
    );
    return (
      <li key={quest.number}>
        <button className="quest-row" onClick={() => openQuest(quest)}>
          <span className="quest-row-title">
            <small>이슈 #{quest.number}</small>
            <strong>{quest.title}</strong>
          </span>
          <AdventurerParty
            members={quest.adventurers ?? []}
            resting={monsterRest(quest)}
          />
          <IssueBadge quest={quest} showOutcome={false} />
          <ChevronRight size={16} />
        </button>
        {children.length > 0 && (
          <ul>
            {children.map((child) =>
              render(child, [...ancestry, quest.number]),
            )}
          </ul>
        )}
      </li>
    );
  }

  const palace = (
    <Dialog
      title={region.slug}
      className="palace-dialog"
      close={close}
      headingActions={
        <>
          <a
            className="icon-button"
            href={`https://github.com/${region.slug}`}
            target="_blank"
            rel="noreferrer"
            aria-label="저장소로 이동"
            title="저장소로 이동"
          >
            <ExternalLink size={18} aria-hidden="true" />
          </a>
          <button
            className="icon-button remove-region"
            onClick={() => setConfirmRemoval(true)}
            aria-label="월드맵에서 제거"
            title="월드맵에서 제거"
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </>
      }
    >
      {snapshot?.error && <p className="fetch-error">{snapshot.error}</p>}
      {snapshot?.report?.warnings.length ? (
        <p className="fetch-error">
          일부 기록을 확인하지 못했습니다 ·{' '}
          {snapshot.report.warnings.join(', ')}
        </p>
      ) : null}
      {ordered.length > 0 && (
        <ul className="quest-tree">{ordered.map((quest) => render(quest))}</ul>
      )}
      {openWork && (
        <button className="text-button" onClick={openWork}>
          작업 목록
        </button>
      )}
      {!!snapshot?.report?.releases.length && (
        <>
          <h4>
            왕국 배포 기록 <small>(KST)</small>
          </h4>
          <div className="release-history">
            {snapshot.report.releases.map((release, index) => {
              const status = release.status?.split(' · ')[0];
              return (
                <a
                  className="release-row"
                  key={index}
                  href={release.url}
                  target="_blank"
                  rel="noreferrer"
                  title={[release.title, release.status]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  {release.at && Number.isFinite(Date.parse(release.at)) ? (
                    <time dateTime={release.at}>
                      {releaseTime.format(new Date(release.at))}
                    </time>
                  ) : (
                    <span>시각 미확인</span>
                  )}
                  <span className={`badge ${release.stage}`}>
                    {status === 'failure' ? 'failed' : status || '미확인'}
                  </span>
                  <span className="release-name">{release.title}</span>
                </a>
              );
            })}
          </div>
        </>
      )}
    </Dialog>
  );
  return (
    <>
      {palace}
      {confirmRemoval && (
        <Dialog title="월드맵에서 제거" close={() => setConfirmRemoval(false)}>
          <p>{region.slug} 저장소를 월드맵에서 제거할까요?</p>
          <div className="removal-actions">
            <button
              className="text-button"
              onClick={() => setConfirmRemoval(false)}
            >
              취소
            </button>
            <button className="primary remove-region" onClick={remove}>
              제거
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function TokenDialog({
  token,
  status,
  setToken,
  openAdd,
  close,
}: {
  token: string;
  status: ReturnType<typeof getTokenStatus>;
  setToken: (token: string) => void;
  openAdd: () => void;
  close: () => void;
}) {
  const [value, setValue] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = value.trim();
    if (!next) return;
    setToken(next);
    close();
    openAdd();
  }
  return (
    <Dialog title="GitHub 연결" close={close}>
      <p>
        비공개 지역을 탐험하거나 GitHub API 사용 한도를 높이려면 GitHub 토큰을
        연결하세요.
      </p>
      {token && (
        <div className="token-result" role="status">
          <strong className="token-status" data-tone={status.tone}>
            {status.label}
          </strong>
          <p>{status.description}</p>
        </div>
      )}
      <form className="token-form" onSubmit={submit}>
        <input
          id="github-token"
          aria-label="GitHub 토큰"
          type="password"
          autoComplete="off"
          required
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="github_pat_…"
        />
        <button type="submit" className="primary">
          <KeyRound size={16} /> {token ? '토큰 변경' : '토큰 연결'}
        </button>
      </form>
      {token && (
        <button
          className="text-button"
          onClick={() => {
            setToken('');
            close();
          }}
        >
          현재 토큰 연결 해제
        </button>
      )}
    </Dialog>
  );
}

function RepositoryDialog({
  token,
  regions,
  added,
  select,
  close,
}: {
  token: string;
  regions: Region[];
  added: (repos: Repository[]) => void;
  select: (region: Region) => void;
  close: () => void;
}) {
  const [value, setValue] = useState('');
  const [page, setPage] = useState<RepositoryPage>();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController>(null);
  const owner = repositoryOwner(value);
  const existing = new Set(regions.map(({ slug }) => slug));
  useEffect(() => () => controller.current?.abort(), []);

  async function run(operation: (signal: AbortSignal) => Promise<void>) {
    if (controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setError('');
    setPending(true);
    try {
      await operation(current.signal);
    } catch (cause) {
      if (!current.signal.aborted) setError((cause as Error).message);
    } finally {
      controller.current = null;
      if (!current.signal.aborted) setPending(false);
    }
  }

  function verify(slug: string, signal: AbortSignal) {
    return request<Repository>(
      new URLSearchParams({ repo: slug, repository: '1' }),
      token,
      signal,
    );
  }

  function browse(account: string, cursor?: string) {
    return run(async (signal) => {
      const params = new URLSearchParams({ owner: account });
      if (cursor) params.set('cursor', cursor);
      const result = await request<RepositoryPage>(params, token, signal);
      if (signal.aborted) return;
      setPage((previous) => {
        if (!cursor || !previous) return result;
        const repos = new Map(
          previous.repositories.map((repo) => [repo.slug, repo]),
        );
        for (const repo of result.repositories) repos.set(repo.slug, repo);
        return { ...result, repositories: [...repos.values()] };
      });
      if (!cursor) setChecked(new Set());
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (owner) {
      void browse(owner);
      return;
    }
    const slug = repositoryInput(value);
    if (!slug) {
      setError('owner, owner/repo 또는 GitHub 저장소 주소를 입력하세요.');
      return;
    }
    const match = regions.find((region) => region.slug === slug);
    if (match) {
      select(match);
      close();
      return;
    }
    void run(async (signal) => {
      const repo = await verify(slug, signal);
      if (signal.aborted) return;
      const duplicate = regions.find((region) => region.slug === repo.slug);
      if (duplicate) select(duplicate);
      else added([repo]);
      close();
    });
  }

  function addChecked() {
    void run(async (signal) => {
      const verified = new Map<string, Repository>();
      const errors: string[] = [];
      for (const slug of checked) {
        if (existing.has(slug) || signal.aborted) continue;
        try {
          const repo = await verify(slug, signal);
          if (!existing.has(repo.slug)) verified.set(repo.slug, repo);
        } catch (cause) {
          if (!signal.aborted)
            errors.push(`${slug} · ${(cause as Error).message}`);
        }
      }
      if (signal.aborted) return;
      if (verified.size) added([...verified.values()]);
      if (errors.length) setError(errors.join('\n'));
      else close();
    });
  }

  return (
    <Dialog title="저장소 추가" className="repository-dialog" close={close}>
      <form className="token-form" onSubmit={submit} aria-busy={pending}>
        <input
          id="github-repository"
          aria-label="GitHub 계정 또는 저장소"
          placeholder="owner 또는 owner/repo"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={value}
          disabled={pending}
          onChange={(event) => {
            setValue(event.target.value);
            setPage(undefined);
            setChecked(new Set());
            setError('');
          }}
          required
        />
        <button className="primary" type="submit" disabled={pending}>
          {owner ? '목록 보기' : '추가'}
        </button>
      </form>
      {page && (
        <>
          {page.repositories.length ? (
            <fieldset
              className="repository-options"
              disabled={pending}
              aria-label="저장소 선택"
            >
              {page.repositories.map((repo) => (
                <label key={repo.slug}>
                  <input
                    type="checkbox"
                    disabled={existing.has(repo.slug)}
                    checked={existing.has(repo.slug) || checked.has(repo.slug)}
                    onChange={(event) => {
                      const selected = event.target.checked;
                      setChecked((items) => {
                        const next = new Set(items);
                        if (selected) next.add(repo.slug);
                        else next.delete(repo.slug);
                        return next;
                      });
                    }}
                  />
                  <span>{repo.slug}</span>
                  {(existing.has(repo.slug) || repo.private) && (
                    <small>
                      {existing.has(repo.slug) ? '추가됨' : '비공개'}
                    </small>
                  )}
                </label>
              ))}
            </fieldset>
          ) : (
            <p>
              {page.next
                ? '이 페이지에 표시할 저장소가 없습니다.'
                : '조회 가능한 저장소가 없습니다.'}
            </p>
          )}
          {page.next && owner && (
            <button
              className="text-button"
              disabled={pending}
              onClick={() => void browse(owner, page.next)}
            >
              더 보기
            </button>
          )}
          <button
            className="primary repository-add-selected"
            disabled={
              pending || ![...checked].some((slug) => !existing.has(slug))
            }
            onClick={addChecked}
          >
            <Plus size={16} aria-hidden="true" /> 선택한 저장소 추가
          </button>
        </>
      )}
      {error && (
        <p className="fetch-error repository-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

type HeritageSelection = {
  region: Region;
  metric: HeritageMetric;
  record?: HeritageRecord;
};

function HeritageDetail({
  selection,
  close,
}: {
  selection: HeritageSelection;
  close: () => void;
}) {
  const { region, metric, record } = selection;
  const { title, label, sprite } = heritageBuildings[metric];
  return (
    <Dialog title={title} close={close}>
      <div className="facility-detail">
        <WorldArt
          sprite={sprite}
          size={heritageSize(heritageTier(metric, record?.count))}
          className="facility-sprite"
        />
        <span>{region.name}</span>
      </div>
      <dl className="heritage-total">
        <dt>{label}</dt>
        <dd>{record ? record.count.toLocaleString('ko-KR') : '미확인'}</dd>
      </dl>
      {!record && <p>현재 조회 범위에서 전체 합계를 확인하지 못했습니다.</p>}
      {record?.source === 'search' && (
        <p>GitHub 검색 인덱스 기준이며 최근 변경 반영이 늦을 수 있습니다.</p>
      )}
      {metric === 'comments' && record && (
        <p>이슈·PR 대화 댓글과 PR 코드 리뷰 댓글을 합산합니다.</p>
      )}
    </Dialog>
  );
}

type MapEntry = { region: Region; number: number; kind?: 'pull' };

function App() {
  const [settings, setSettings] = useState(readSettings);
  const { token, repositories } = settings;
  const worldRegions = useMemo(
    () => repositories.map(({ slug }) => repositoryRegion(slug)),
    [repositories],
  );
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
  const [selected, setSelected] = useState<Region>();
  const [selectedQuest, setSelectedQuest] = useState<MapEntry>();
  const [refreshUsage, setRefreshUsage] = useState<{
    token: string;
    usage: RefreshConsumption;
    stale: boolean;
  }>();
  const [selectedRoad, setSelectedRoad] = useState<{
    region: Region;
    selection: RoadSelection | 'plaza';
  }>();
  const [selectedHeritage, setSelectedHeritage] = useState<HeritageSelection>();
  const [inspected, setInspected] = useState<MapEntry>();
  const updateSelectedHeritage = useCallback((slug: string, data: Heritage) => {
    setSelectedHeritage((current) => {
      if (!current || current.region.slug !== slug) return current;
      const record = data[current.metric];
      return record ? { ...current, record } : current;
    });
  }, []);
  function inspect(entry: MapEntry, active: boolean) {
    setInspected((current) =>
      active
        ? entry
        : current?.region.slug === entry.region.slug &&
            current.number === entry.number &&
            current.kind === entry.kind
          ? undefined
          : current,
    );
  }
  const refresh = useRef<(() => void) | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshInterval = token ? 20_000 : 60_000;
  const [progress, setProgress] = useState({
    duration: refreshInterval,
    key: 0,
  });
  const refreshJobs = useRef<{
    token: string;
    jobs: Map<
      string,
      {
        last: number;
        interval: number;
        report?: Report;
        branchCheckedAt?: number;
      }
    >;
  }>({ token, jobs: new Map() });
  const [showConnect, setShowConnect] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(
        settingsKey,
        JSON.stringify({ version: settingsVersion, ...settings }),
      );
      localStorage.removeItem(legacyRepositoryListKey);
    } catch {
      // The current tab can still use the settings when storage is unavailable.
    }
  }, [settings]);

  useEffect(() => {
    function restoreSettings(event: StorageEvent) {
      if (
        event.storageArea !== localStorage ||
        (event.key !== null && event.key !== settingsKey)
      )
        return;
      const next = readSettings();
      refreshJobs.current.jobs.clear();
      setSelectedHeritage(undefined);
      setSelectedRoad(undefined);
      setSettings(next);
      setSnapshots({});
      setSelected(undefined);
      setSelectedQuest(undefined);
      setLoading(true);
      if (next.token !== token) setShowAdd(false);
    }

    window.addEventListener('storage', restoreSettings);
    return () => window.removeEventListener('storage', restoreSettings);
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();
    if (refreshJobs.current.token !== token)
      refreshJobs.current = { token, jobs: new Map() };
    const jobs = refreshJobs.current.jobs;
    const slugs = new Set(worldRegions.map(({ slug }) => slug));
    for (const slug of jobs.keys()) if (!slugs.has(slug)) jobs.delete(slug);
    const pending = new Set<string>();
    let forceRequested = false;
    let nextBatch = 0;
    let publishedBatch = 0;
    let timer: number | undefined;

    function schedule() {
      window.clearTimeout(timer);
      if (controller.signal.aborted) return;
      setLoading(pending.size > 0);
      const now = Date.now();
      const hidden = document.visibilityState !== 'visible';
      let next = Infinity;
      if (forceRequested) {
        if (pending.size) return;
        forceRequested = false;
        void syncBatch([...slugs], true);
      } else {
        const dueSlugs: string[] = [];
        for (const slug of slugs) {
          if (pending.has(slug)) continue;
          const job = jobs.get(slug);
          const due = job ? refreshDue(job.last, job.interval, hidden) : now;
          if (due <= now) dueSlugs.push(slug);
          else next = Math.min(next, due);
        }
        if (dueSlugs.length) void syncBatch(dueSlugs, false);
      }
      setLoading(pending.size > 0);
      if (Number.isFinite(next)) {
        const duration = Math.max(1, next - now);
        timer = window.setTimeout(schedule, duration);
        setProgress((previous) => ({ duration, key: previous.key + 1 }));
      }
    }

    async function syncBatch(batch: string[], force: boolean) {
      if (!batch.length) return;
      const id = ++nextBatch;
      const usages = await Promise.all(batch.map((slug) => sync(slug, force)));
      if (controller.signal.aborted || id < publishedBatch) return;
      publishedBatch = id;
      const limits = new Set(
        usages.flatMap((usage) =>
          usage?.limit === undefined ? [] : [usage.limit],
        ),
      );
      const consumed =
        limits.size <= 1 &&
        usages.every((usage) => usage?.consumed !== undefined)
          ? usages.reduce((sum, usage) => sum + (usage?.consumed ?? 0), 0)
          : undefined;
      setRefreshUsage((previous) => {
        const last = previous?.token === token ? previous.usage : undefined;
        if (consumed === undefined)
          return {
            token,
            usage: last ?? {},
            stale: last?.consumed !== undefined,
          };
        return {
          token,
          usage: {
            consumed,
            limit:
              limits.size === 1 ? limits.values().next().value : last?.limit,
          },
          stale: false,
        };
      });
    }

    async function sync(slug: string, force: boolean) {
      pending.add(slug);
      const previous = jobs.get(slug);
      const checkBranches =
        force ||
        Date.now() - (previous?.branchCheckedAt ?? -Infinity) >= 120_000;
      const branchCheckedAt = checkBranches
        ? Date.now()
        : previous?.branchCheckedAt;
      let usage: RefreshConsumption | undefined;
      try {
        const params = new URLSearchParams({ repo: slug, measure: 'refresh' });
        if (force) params.set('refresh', '1');
        if (checkBranches) params.set('branches', '1');
        const report = await request<Report>(
          params,
          token,
          controller.signal,
          (measured) => {
            usage = measured;
          },
        );
        if (controller.signal.aborted) return;
        const prior = previous?.report && partyStates(previous.report);
        const current = partyStates(report);
        const changed =
          !prior ||
          prior.size !== current.size ||
          [...current].some(([key, value]) => prior.get(key) !== value) ||
          JSON.stringify(previous?.report?.releases) !==
            JSON.stringify(report.releases);
        const active =
          report.quests.some(({ stage }) => activeStages.has(stage)) ||
          reportForges(report).some(({ stage }) => activeStages.has(stage)) ||
          report.releases.some(({ stage }) => activeStages.has(stage));
        const interval = nextRefreshInterval(
          refreshInterval,
          previous?.interval ?? refreshInterval,
          Boolean(active) || report.warnings.length > 0,
          changed,
        );
        jobs.set(slug, { last: Date.now(), report, interval, branchCheckedAt });
        setSnapshots((current) => ({
          ...current,
          [slug]: reportSnapshot(report, current[slug]),
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        jobs.set(slug, {
          last: Date.now(),
          interval: refreshInterval,
          report: previous?.report,
          branchCheckedAt,
        });
        setSnapshots((current) => ({
          ...current,
          [slug]: {
            ...current[slug],
            error: (error as Error).message,
            httpStatus:
              error instanceof RequestError ? error.status : undefined,
          },
        }));
      } finally {
        pending.delete(slug);
        schedule();
      }
      return usage;
    }

    refresh.current = () => {
      forceRequested = true;
      schedule();
    };
    schedule();
    document.addEventListener('visibilitychange', schedule);
    return () => {
      refresh.current = null;
      document.removeEventListener('visibilitychange', schedule);
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [token, worldRegions, refreshInterval]);

  function setToken(value: string) {
    if (value === token) return;
    setSettings((current) => ({
      token: value,
      repositories: current.repositories.filter((repo) => !repo.private),
    }));
    setSelected(undefined);
    setSnapshots({});
    setSelectedQuest(undefined);
    setSelectedHeritage(undefined);
    setSelectedRoad(undefined);
    setLoading(true);
  }

  function select(region: Region) {
    setSelected(region);
    setSelectedQuest(undefined);
  }

  function removeRegion(region: Region) {
    setSettings((current) => ({
      ...current,
      repositories: current.repositories.filter(
        ({ slug }) => slug !== region.slug,
      ),
    }));
    setSnapshots((current) => {
      const remaining = { ...current };
      delete remaining[region.slug];
      return remaining;
    });
    setSelected(undefined);
    setSelectedQuest(undefined);
  }

  const roadPlacements = useMemo(() => {
    const placements = new Map<string, ReturnType<typeof placeBranchRoads>>();
    for (const [slug, { report }] of Object.entries(snapshots)) {
      if (report)
        placements.set(
          slug,
          placeBranchRoads(report.branchInventory, report.branchPulls),
        );
    }
    return placements;
  }, [snapshots]);

  const hasData = worldRegions.some(({ slug }) => snapshots[slug]?.report);
  const tokenStatus = getTokenStatus(
    hasData,
    worldRegions.length > 0,
    Object.values(snapshots).find(({ error }) => error),
  );
  const partial = worldRegions.some(
    ({ slug }) =>
      !snapshots[slug]?.report ||
      snapshots[slug].error ||
      snapshots[slug].report?.warnings.length,
  );
  const quest =
    selectedQuest &&
    selectedQuest.kind !== 'pull' &&
    snapshots[selectedQuest.region.slug]?.report?.quests.find(
      ({ number }) => number === selectedQuest.number,
    );
  const pull =
    selectedQuest?.kind === 'pull'
      ? reportForges(snapshots[selectedQuest.region.slug]?.report).find(
          ({ number }) => number === selectedQuest.number,
        )
      : undefined;

  function openPull(region: Region, item: PullQuest) {
    setSelectedQuest({ region, number: item.number, kind: 'pull' });
  }

  return (
    <>
      <main className="world" aria-labelledby="world-title">
        <header className="world-header">
          <div className="world-heading">
            <span className="crest" aria-hidden="true">
              <WorldArt sprite="palace" size={22} />
            </span>
            <h1 id="world-title" className="brand">
              Agentopia
            </h1>
          </div>
          <div className="world-controls">
            <button
              className="connect add-repository-button"
              aria-label="저장소 추가"
              title="저장소 추가"
              onClick={() => setShowAdd(true)}
            >
              <Plus size={19} aria-hidden="true" />
            </button>
            <button
              className="connect ticket-button"
              data-filled={Boolean(token)}
              data-tone={token ? tokenStatus.tone : undefined}
              aria-label={token ? tokenStatus.label : 'GitHub 연결'}
              title={token ? tokenStatus.label : 'GitHub 연결'}
              onClick={() => setShowConnect(true)}
            >
              <Ticket size={19} aria-hidden="true" />
            </button>
            <div className="refresh-control">
              <button
                className="refresh-button"
                aria-label="새로 고침"
                aria-busy={loading}
                data-warning={!loading && partial}
                title={
                  !loading && partial
                    ? '일부 GitHub 기록을 확인하지 못했습니다.'
                    : `다음 자동 갱신까지 약 ${Math.ceil(progress.duration / 1000)}초`
                }
                disabled={!worldRegions.length}
                onClick={() => refresh.current?.()}
              >
                {!loading && (
                  <span
                    key={progress.key}
                    className="refresh-fill"
                    style={{ animationDuration: `${progress.duration}ms` }}
                    aria-hidden="true"
                  />
                )}
                <RefreshCw
                  size={16}
                  className={loading ? 'rotate' : ''}
                  aria-hidden="true"
                />
              </button>
              <GitHubUsage
                token={token}
                refresh={
                  refreshUsage?.token === token ? refreshUsage.usage : undefined
                }
                refreshStale={
                  refreshUsage?.token === token && refreshUsage.stale
                }
              />
            </div>
          </div>
        </header>

        <section className="map-viewport" aria-label="저장소 왕국">
          <div className="kingdoms">
            {worldRegions.map((region) => {
              const snapshot = snapshots[region.slug];
              const report = snapshot?.report;
              const forges = reportForges(report);
              const focus = selectedQuest ?? inspected;
              const localFocus =
                focus?.region.slug === region.slug ? focus : undefined;
              const related = new Set(
                localFocus?.kind === 'pull'
                  ? forges.find(({ number }) => number === localFocus.number)
                      ?.issues
                  : [],
              );
              const placement = roadPlacements.get(region.slug);
              const visibleFacilities = forges
                .filter(isCurrentFacility)
                .sort(
                  (left, right) =>
                    (placement?.facilityOrder.get(left.number) ??
                      Number.MAX_SAFE_INTEGER) -
                    (placement?.facilityOrder.get(right.number) ??
                      Number.MAX_SAFE_INTEGER),
                );
              const issueOrder = new Map<number, number>();
              visibleFacilities.forEach((pull, index) => {
                for (const issue of pull.issues ?? []) {
                  if (!issueOrder.has(issue)) issueOrder.set(issue, index);
                }
              });
              return (
                <section
                  className="kingdom-region"
                  aria-label={region.name}
                  key={region.slug}
                  style={
                    {
                      '--kingdom-hue': kingdomHue(region.slug),
                    } as CSSProperties
                  }
                >
                  <div className="kingdom-area">
                    <KingdomWall />
                    <HeritageArc
                      slug={region.slug}
                      name={region.name}
                      token={token}
                      load={requestHeritage}
                      onLoad={updateSelectedHeritage}
                      open={(metric, record) =>
                        setSelectedHeritage({ region, metric, record })
                      }
                    />
                    <button
                      className="kingdom"
                      data-road-palace=""
                      title={
                        placement?.palace
                          ? `왕궁 · ${placement.palace}`
                          : undefined
                      }
                      onClick={() => select(region)}
                    >
                      <WorldArt
                        sprite="palace"
                        size={objectSizes.palace}
                        className="kingdom-crest"
                      />
                      <span className="kingdom-label">
                        <strong>{region.name}</strong>
                      </span>
                    </button>
                    {placement && (
                      <BranchRoadMap
                        placement={placement}
                        highlightedIssue={
                          localFocus?.kind !== 'pull'
                            ? localFocus?.number
                            : undefined
                        }
                        highlightedPull={
                          localFocus?.kind === 'pull'
                            ? localFocus.number
                            : undefined
                        }
                        open={(selection) =>
                          setSelectedRoad({
                            region,
                            selection:
                              selection.roads.length === 1 &&
                              selection.roads[0].role === 'plaza'
                                ? 'plaza'
                                : selection,
                          })
                        }
                      />
                    )}
                    {visibleFacilities.length > 0 && (
                      <ul
                        className="expeditions kingdom-workshops"
                        aria-label={`${region.name} 왕국 내부`}
                      >
                        {visibleFacilities.map((item) => (
                          <li
                            key={item.number}
                            data-road-pr={item.number}
                            data-road-issues={item.issues?.join(' ')}
                          >
                            <FacilityMarker
                              pull={item}
                              open={() => openPull(region, item)}
                              pulse={snapshot?.pulses?.[`pr-${item.number}`]}
                              inspected={
                                localFocus?.kind === 'pull' &&
                                localFocus.number === item.number
                              }
                              related={
                                localFocus !== undefined &&
                                localFocus.kind !== 'pull' &&
                                Boolean(
                                  item.issues?.includes(localFocus.number),
                                )
                              }
                              inspect={(active) =>
                                inspect(
                                  { region, number: item.number, kind: 'pull' },
                                  active,
                                )
                              }
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {report && (
                    <KingdomMonsters
                      quests={report.quests}
                      issueOrder={issueOrder}
                      pulses={snapshot?.pulses}
                      label={`${region.name} 왕국 외부 몬스터`}
                      highlight={
                        localFocus?.kind === undefined
                          ? localFocus?.number
                          : undefined
                      }
                      related={related}
                      inspect={(number, active) =>
                        inspect({ region, number }, active)
                      }
                      openQuest={(item) =>
                        setSelectedQuest({ region, number: item.number })
                      }
                    />
                  )}
                </section>
              );
            })}
          </div>
        </section>

        <footer className="world-footer">
          <ul className="expedition-legend" aria-label="기본 파티 구성">
            <li className="actions">
              <PartyLeaderGlyph /> 파티장
            </li>
            <li className="codex">
              <AdventurerGlyph agent="codex" /> Codex
            </li>
            <li className="claude">
              <AdventurerGlyph agent="claude" /> Claude
            </li>
            <li className="release">
              <PortalKeeperGlyph /> 포탈 관리자
            </li>
          </ul>
        </footer>
      </main>
      {selected && (
        <RegionDetail
          key={selected.slug}
          region={selected}
          snapshot={snapshots[selected.slug]}
          openWork={
            roadPlacements.get(selected.slug)?.plazaRoad
              ? undefined
              : () => setSelectedRoad({ region: selected, selection: 'plaza' })
          }
          openQuest={(item) =>
            setSelectedQuest({ region: selected, number: item.number })
          }
          remove={() => removeRegion(selected)}
          close={() => setSelected(undefined)}
        />
      )}
      {showAdd && (
        <RepositoryDialog
          token={token}
          regions={worldRegions}
          added={(repos) =>
            setSettings((current) => ({
              ...current,
              repositories: [...current.repositories, ...repos],
            }))
          }
          select={select}
          close={() => setShowAdd(false)}
        />
      )}
      {showConnect && (
        <TokenDialog
          token={token}
          status={tokenStatus}
          setToken={setToken}
          openAdd={() => setShowAdd(true)}
          close={() => setShowConnect(false)}
        />
      )}
      {selectedHeritage && (
        <HeritageDetail
          selection={selectedHeritage}
          close={() => setSelectedHeritage(undefined)}
        />
      )}
      {selectedRoad?.selection === 'plaza' && (
        <PlazaDetail
          region={selectedRoad.region}
          pulls={reportForges(snapshots[selectedRoad.region.slug]?.report)}
          openPull={(item) => openPull(selectedRoad.region, item)}
          close={() => setSelectedRoad(undefined)}
        />
      )}
      {selectedRoad && selectedRoad.selection !== 'plaza' && (
        <Dialog
          title={
            selectedRoad.selection.roads.length === 1
              ? selectedRoad.selection.roads[0].name
              : '브랜치 도로망'
          }
          close={() => setSelectedRoad(undefined)}
        >
          {selectedRoad.selection.partial && (
            <p>브랜치 목록의 첫 페이지와 열린 PR에서 확인한 경로입니다.</p>
          )}
          <ul className="branch-road-details">
            {selectedRoad.selection.roads.map((road) => (
              <li key={road.name}>
                <strong>{road.name}</strong>
                {road.role === 'palace' && <small>왕궁</small>}
                {road.role === 'plaza' && <small>개발 광장</small>}
                {road.parent && <small>관측된 PR 대상 · {road.parent}</small>}
                {road.pulls.map((pull) => (
                  <OutLink
                    key={pull.number}
                    item={{
                      title: `PR #${pull.number} · ${pull.base}`,
                      status: pull.merged ? '머지됨' : '열림',
                      url: `https://github.com/${selectedRoad.region.slug}/pull/${pull.number}`,
                    }}
                  />
                ))}
              </li>
            ))}
          </ul>
        </Dialog>
      )}
      {selectedQuest && pull && (
        <PullDetail
          key={`${selectedQuest.region.slug}-pr-${pull.number}`}
          pull={pull}
          region={selectedQuest.region}
          token={token}
          openIssue={(number) => {
            const region = selectedQuest.region;
            if (
              !snapshots[region.slug]?.report?.quests.some(
                (item) => item.number === number,
              )
            )
              return false;
            setSelectedQuest({ region, number });
            return true;
          }}
          close={() => setSelectedQuest(undefined)}
        />
      )}
      {selectedQuest && quest && (
        <QuestDetail
          key={`${selectedQuest.region.slug}-${quest.number}`}
          quest={quest}
          region={selectedQuest.region}
          token={token}
          close={() => setSelectedQuest(undefined)}
        />
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
