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
} from 'lucide-react';
import { stages } from '../server/model.ts';
import type { PullQuest, Quest, Region, Stage } from '../server/model.ts';
import {
  AdventurerParty,
  PartyLeaderGlyph,
  agentNames,
  MonsterGlyph,
  partyLabel,
  partyLeaderLabel,
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
      data-working={
        (activeStages.has(quest.stage) && quest.stage !== 'queued') || undefined
      }
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
      <MonsterGlyph
        boss={boss}
        defeated={defeated}
        reopened={quest.reopened}
        commits={quest.activity?.commits}
      />
      <small className="expedition-number">{`#${quest.number}`}</small>
      <AdventurerParty
        members={members}
        resting={resting}
        leader={quest.stage === 'ci' ? 'active' : undefined}
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
      data-working={
        (activeStages.has(pull.stage) && pull.stage !== 'queued') || undefined
      }
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
