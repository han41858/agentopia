import {
  Check,
  Clock3,
  Flag,
  GitPullRequest,
  Hourglass,
  RotateCcw,
  ScrollText,
  Swords,
  Skull,
  Trophy,
  Pause,
  CircleHelp,
  Square,
} from 'lucide-react';
import { stages } from '../server/model.ts';
import type {
  PullQuest,
  Quest,
  RecoveryBadge,
  Region,
  Stage,
} from '../server/model.ts';
import {
  AdventurerParty,
  PartyLeaderGlyph,
  agentNames,
  MonsterGlyph,
  partyLabel,
} from './characters.tsx';
import type { ActivityProfile } from '../server/activity.ts';
import { ActivityAura, ReviewOpinionBadge } from './activity-effects.tsx';
import { facilities, FacilityGlyph } from './facility-art.tsx';
import { facilityKind } from './facility-kind.ts';
import { activeStages, alerts } from './snapshot.ts';

export function kingdomHue(slug: string) {
  let hash = 2166136261;
  for (const character of slug.toLowerCase()) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return ((hash >>> 0) % 36_000) / 100;
}

export const glyph = {
  idle: Clock3,
  queued: Hourglass,
  developing: Swords,
  revising: RotateCcw,
  reviewing: ScrollText,
  ci: PartyLeaderGlyph,
  deploying: null,
  merging: GitPullRequest,
  complete: Trophy,
  returned: null,
  failed: Skull,
  attention: Flag,
};

export function monsterRest(quest: Quest) {
  if (
    quest.stage === 'returned' ||
    quest.stage === 'complete' ||
    quest.state === 'closed'
  )
    return '귀환';
  return '대기';
}

const markerStageLabels: Record<Stage, string> = {
  idle: '대기',
  queued: '작업 대기 중',
  developing: '개발 중',
  revising: '수정 중',
  reviewing: '리뷰 중',
  ci: 'GitHub Actions · CI 실행 중',
  deploying: '배포 중',
  merging: 'PR 병합 중',
  complete: '작업 완료',
  returned: '작업 종료',
  failed: '실행 실패',
  attention: '개입 필요',
};

function markerMemberLabel(member: NonNullable<Quest['adventurers']>[number]) {
  return member.fallen
    ? `${agentNames[member.agent]} · 실행 실패`
    : partyLabel(member, '대기');
}

function recoveryTooltip(title: string, badge?: RecoveryBadge) {
  if (!badge) return title;
  const name = {
    pending: '실행 대기',
    waiting: '재시도 대기',
    failed: '최종 실패',
    repairing: '자동 수정 중',
    checking: '수정 후 CI 재검사 중',
    stopped: '사람 확인 필요',
  }[badge.kind];
  return [
    title,
    name,
    badge.attempt && badge.limit
      ? `${badge.attempt}/${badge.limit}회`
      : undefined,
    badge.reason,
  ]
    .filter(Boolean)
    .join(' · ');
}

function RecoveryGlyph({
  badge,
  className,
}: {
  badge: RecoveryBadge;
  className: string;
}) {
  const Icon = {
    pending: Pause,
    waiting: Pause,
    failed: Square,
    stopped: CircleHelp,
    repairing: null,
    checking: null,
  }[badge.kind];
  return (
    Icon && (
      <Icon
        className={className}
        data-status={badge.kind}
        size={14}
        aria-hidden="true"
      />
    )
  );
}

function markerBadge(
  stage: Stage,
  recovery?: RecoveryBadge,
  reason?: string,
  ciQueued = false,
): RecoveryBadge | undefined {
  if (ciQueued && (!recovery || recovery.kind === 'checking'))
    return { kind: recovery ? 'waiting' : 'pending' };
  if (recovery) return recovery;
  if (stage === 'queued') return { kind: 'pending' };
  if (stage === 'failed') return { kind: 'failed', reason };
  if (stage === 'attention') return { kind: 'stopped', reason };
}

const issueCILabels: Record<NonNullable<Quest['issueCIStatus']>, string> = {
  waiting: 'GitHub Actions · CI 대기 중',
  running: markerStageLabels.ci,
  passed: 'GitHub Actions · CI 성공',
  finished: 'GitHub Actions · CI 종료',
};

export function MonsterMarker({
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
  const badge = !defeated
    ? markerBadge(
        quest.stage,
        quest.issueRecoveryBadge,
        quest.reason,
        quest.issueCIStatus === 'waiting',
      )
    : undefined;
  const badgeGlyph = badge && (
    <RecoveryGlyph badge={badge} className="monster-recovery" />
  );
  const tooltip = recoveryTooltip(
    `이슈 #${quest.number} · ${quest.title}`,
    badge,
  );
  const label = [
    tooltip,
    defeated ? '이슈 닫힘' : quest.reopened ? '이슈 다시 열림' : '이슈 열림',
    quest.stage === 'ci'
      ? issueCILabels[quest.issueCIStatus ?? 'waiting']
      : quest.stage !== 'idle'
        ? markerStageLabels[quest.stage]
        : undefined,
    quest.victory ? '연결된 PR 병합됨' : undefined,
    quest.issueLeader
      ? quest.stage === 'ci'
        ? '파티장'
        : 'GitHub Actions · 파티장'
      : undefined,
    ...members.map(markerMemberLabel),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      data-road-issue={quest.number}
      data-recovery={badge?.kind}
      data-working={
        (activeStages.has(quest.stage) && quest.stage !== 'queued') || undefined
      }
      className={`expedition monster-marker${boss ? ' boss-marker' : ''}${alerts.has(quest.stage) ? ' blocked' : ''}${defeated ? ' closed-issue' : ''}`}
      aria-label={`${label}${activityEffectsLabel(quest.activity)}`}
      title={tooltip}
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
      <span className="monster-marker-art">
        <MonsterGlyph
          boss={boss}
          defeated={defeated}
          reopened={quest.reopened}
          commits={quest.activity?.commits}
        />
        {!members.length && !quest.issueLeader && badgeGlyph}
      </span>
      <small className="expedition-number">{`#${quest.number}`}</small>
      <AdventurerParty
        members={members}
        resting={resting}
        leader={quest.issueLeader}
        badge={badgeGlyph}
        showTitles={false}
      />
    </button>
  );
}

export function MonsterStatusIcons({ quest }: { quest: Quest }) {
  const StageIcon = glyph[quest.stage];
  return (
    <span className="monster-statuses" aria-hidden="true">
      {quest.state === 'closed' && <Check size={12} />}
      {quest.victory && <Trophy size={12} />}
      {quest.stage !== 'idle' && quest.stage !== 'complete' && StageIcon && (
        <StageIcon size={12} />
      )}
    </span>
  );
}

export function activityEffectsLabel(activity?: ActivityProfile) {
  return activity?.opinion?.state === 'APPROVED'
    ? ' · 리뷰 승인'
    : activity?.opinion?.state === 'CHANGES_REQUESTED'
      ? ' · 수정 요청'
      : '';
}

export function pullStatus(pull: PullQuest) {
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

export function pullActivity(pull: PullQuest) {
  if (pull.reviewer) return `${agentNames[pull.reviewer]} 리뷰 기록`;
  if (pull.author) return `${agentNames[pull.author]} 작성`;
  return undefined;
}

export function partyLeaderState(pull: PullQuest) {
  if (pull.ciQueued) return 'resting';
  if (pull.quality === 'ci' || pull.stage === 'ci') return 'active';
  if (pull.ciParticipated) return 'resting';
}

export function FacilityMarker({
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
  const { Tool } = facilities[kind];
  const working = pull.stage === 'developing' || pull.stage === 'revising';
  const reviewing = pull.stage === 'reviewing';
  const members = pull.adventurers ?? [];
  const activeMembers = members.filter(
    (member) => member.active && !member.fallen,
  );
  const leader = partyLeaderState(pull);
  const badge = markerBadge(
    pull.stage,
    pull.recoveryBadge,
    pull.reason,
    pull.stage === 'ci' && pull.ciQueued,
  );
  const badgeGlyph = badge && (
    <RecoveryGlyph badge={badge} className="facility-recovery" />
  );
  const tooltip = recoveryTooltip(`PR #${pull.number} · ${pull.title}`, badge);
  const label = [
    tooltip,
    pullActivity(pull),
    pull.cancelled ? 'PR 닫힘' : pull.draft ? '초안' : 'PR 열림',
    !pull.cancelled && pull.stage !== 'idle'
      ? pull.stage === 'complete'
        ? 'PR 병합됨'
        : pull.stage === 'ci' && pull.ciQueued
          ? issueCILabels.waiting
          : markerStageLabels[pull.stage]
      : undefined,
    leader === 'active' && pull.stage !== 'ci'
      ? markerStageLabels.ci
      : undefined,
    leader === 'resting' ? 'GitHub Actions · CI 실행 기록' : undefined,
    ...members.map(markerMemberLabel),
    ...(pull.issues ?? []).map((number) => `이슈 #${number}`),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      className={`expedition pull-marker facility-marker${alerts.has(pull.stage) ? ' blocked' : ''}`}
      data-highlight={inspected ? 'selected' : related ? 'related' : undefined}
      data-stage={pull.stage}
      data-working={
        (activeStages.has(pull.stage) && pull.stage !== 'queued') || undefined
      }
      data-recovery={badge?.kind}
      data-facility={kind}
      title={tooltip}
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
          {!members.length && !leader && badgeGlyph}
        </span>
      </ActivityAura>
      <small className="expedition-number">{`PR #${pull.number}`}</small>
      <AdventurerParty
        members={members}
        leader={leader}
        badge={badgeGlyph}
        resting="대기"
        forge
        showTitles={false}
      />
    </button>
  );
}

export function KingdomMonsters({
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

  const comparePlacement = (left: Quest, right: Quest) =>
    (issueOrder.get(left.number) ?? Infinity) -
      (issueOrder.get(right.number) ?? Infinity) || left.number - right.number;
  const roots = openQuests
    .filter(({ parent }) => parent === undefined || !visible.has(parent))
    .sort(comparePlacement);

  function render(quest: Quest) {
    const children = (childrenByParent.get(quest.number) ?? []).filter(
      ({ number }) => visible.has(number),
    );
    children.sort(comparePlacement);
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

export function Badge({ stage, label }: { stage: Stage; label?: string }) {
  const Icon = glyph[stage];
  const description =
    label ?? (stage === 'ci' ? `GitHub Actions · ${stages.ci}` : stages[stage]);
  if (alerts.has(stage) || stage === 'complete' || stage === 'ci') {
    return (
      <span className={`badge ${stage}`} role="img" aria-label={description}>
        {Icon && <Icon size={14} aria-hidden="true" />}
      </span>
    );
  }
  return (
    <span className={`badge ${stage}`}>
      {Icon && <Icon size={14} aria-hidden="true" />}
      {description}
    </span>
  );
}

export function IssueBadge({ quest }: { quest: Quest }) {
  return (
    <span className="monster-statuses">
      {quest.state === 'closed' && (
        <span
          className="badge complete"
          role="img"
          aria-label="몬스터 처치 완료"
        >
          <Check size={14} aria-hidden="true" />
        </span>
      )}
      {quest.victory && <Badge stage="complete" label="제작 결과 반영" />}
      {quest.stage !== 'idle' && quest.stage !== 'complete' ? (
        <Badge stage={quest.stage} />
      ) : quest.state === 'open' && !quest.victory ? (
        <span className="badge idle">몬스터 출현</span>
      ) : null}
    </span>
  );
}

export type MapEntry = { region: Region; number: number; kind?: 'pull' };
