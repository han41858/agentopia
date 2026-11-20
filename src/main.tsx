import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Castle,
  Check,
  ChevronRight,
  Clock3,
  ExternalLink,
  Flag,
  GitPullRequest,
  GitPullRequestDraft,
  Hourglass,
  KeyRound,
  Plus,
  RefreshCw,
  RotateCcw,
  Rocket,
  ScrollText,
  Swords,
  Skull,
  Trophy,
  DoorOpen,
  Ticket,
  Workflow,
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
  agentNames,
  MonsterGlyph,
  partyLabel,
} from './characters.tsx';
import './styles.css';

type Snapshot = {
  report?: Report;
  error?: string;
  httpStatus?: number;
  pulses?: Record<string, number>;
  changed?: Set<string>;
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
        quest.reason,
        quest.pulls
          .map(({ number, status }) => [number, status])
          .sort((a, b) => Number(a[0]) - Number(b[0])),
      ]),
    ]),
    ...(report.pullQuests ?? []).map((pull): [string, string] => [
      `pr-${pull.number}`,
      JSON.stringify([
        pull.stage,
        pull.draft,
        pull.author,
        pull.reviewer,
        pull.review,
      ]),
    ]),
  ]);
}

function reportSnapshot(report: Report, previous?: Snapshot): Snapshot {
  if (!previous?.report) return { report };
  const priorStates = partyStates(previous.report);
  const pulses: Record<string, number> = {};
  const changed = new Set<string>();
  for (const [key, state] of partyStates(report)) {
    const pulse = previous.pulses?.[key] ?? 0;
    if (priorStates.get(key) !== state) changed.add(key);
    const next = pulse + Number(changed.has(key));
    if (next) pulses[key] = next;
  }
  return { report, pulses, changed };
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
  ci: Workflow,
  deploying: Rocket,
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
}: {
  quest: Quest;
  boss: boolean;
  open: () => void;
  pulse?: number;
}) {
  const defeated = quest.state === 'closed';
  const StageIcon = glyph[quest.stage];
  const members = quest.adventurers ?? [];
  const resting = monsterRest(quest);
  const status = [
    defeated ? '몬스터 처치 완료' : '몬스터 출현',
    quest.stage !== 'idle' && quest.stage !== 'complete'
      ? stages[quest.stage]
      : undefined,
    quest.victory ? '전투 승리' : undefined,
    quest.stage === 'failed' ? '구조 요청' : undefined,
    ...members.map((member) => partyLabel(member, resting)),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      className={`expedition monster-marker${boss ? ' boss-marker' : ''}${alerts.has(quest.stage) ? ' blocked' : ''}${defeated ? ' closed-issue' : ''}`}
      aria-label={`${boss ? '보스 몬스터' : '몬스터'} #${quest.number} · ${quest.title} · ${status}`}
      title={`${quest.title} · ${status}`}
      onClick={open}
    >
      {pulse !== undefined && (
        <span key={pulse} className="party-pulse" aria-hidden="true" />
      )}
      <span className="monster-encounter">
        <MonsterGlyph boss={boss} defeated={defeated} />
        <AdventurerParty members={members} resting={resting} />
      </span>
      <small className="expedition-number">
        {defeated && <Check size={12} aria-hidden="true" />}
        {quest.victory && <Trophy size={12} aria-hidden="true" />}
        {quest.stage !== 'idle' && quest.stage !== 'complete' && (
          <StageIcon size={12} aria-hidden="true" />
        )}
        #{quest.number}
      </small>
    </button>
  );
}

function pullStatus(pull: PullQuest) {
  if (pull.stage !== 'idle') return stages[pull.stage];
  return pull.draft ? '초안' : 'PR 열림';
}

function pullActivity(pull: PullQuest) {
  if (pull.reviewer) return `${agentNames[pull.reviewer]} 리뷰 기록`;
  if (pull.author) return `${agentNames[pull.author]} 작성`;
  return undefined;
}

function PullMarker({
  pull,
  open,
  pulse,
}: {
  pull: PullQuest;
  open: () => void;
  pulse?: number;
}) {
  const agent = pull.reviewer ?? pull.author;
  const ci = pull.stage === 'ci';
  const Icon = ci
    ? Workflow
    : pull.draft
      ? GitPullRequestDraft
      : GitPullRequest;
  const iconOnly = pull.stage === 'idle' || ci || pull.stage === 'complete';
  const label = [`PR #${pull.number}`, pull.title, pullActivity(pull)]
    .filter(Boolean)
    .join(' · ');
  const status = pullStatus(pull);
  return (
    <button
      className={`expedition pull-marker${alerts.has(pull.stage) ? ' blocked' : ''}`}
      title={
        alerts.has(pull.stage) || iconOnly ? label : `${label} · ${status}`
      }
      aria-label={`${label} · ${status}`}
      onClick={open}
    >
      {pulse !== undefined && (
        <span key={pulse} className="party-pulse" aria-hidden="true" />
      )}
      <span
        className={`role-symbol current-role${ci ? ' actions' : ''}`}
        data-draft={pull.draft}
      >
        {!ci && agent ? (
          <AdventurerGlyph agent={agent} />
        ) : (
          <Icon size={15} aria-hidden="true" />
        )}
      </span>
      <small className="expedition-number">PR #{pull.number}</small>
      {alerts.has(pull.stage) ? (
        <Badge stage={pull.stage} />
      ) : iconOnly ? null : (
        <small className="expedition-status-label">{status}</small>
      )}
    </button>
  );
}

function KingdomMonsters({
  quests,
  pulls,
  pulses,
  changed,
  label,
  openQuest,
  openPull,
  openList,
}: {
  quests: Quest[];
  pulls: PullQuest[];
  pulses?: Record<string, number>;
  changed?: Set<string>;
  label: string;
  openQuest: (quest: Quest) => void;
  openPull: (pull: PullQuest) => void;
  openList: () => void;
}) {
  const byNumber = new Map(quests.map((quest) => [quest.number, quest]));
  const childrenByParent = new Map<number, Quest[]>();
  for (const quest of quests) {
    if (quest.parent === undefined) continue;
    const siblings = childrenByParent.get(quest.parent) ?? [];
    siblings.push(quest);
    childrenByParent.set(quest.parent, siblings);
  }

  const descendants = new Set<number>();
  function includeDescendants(quest: Quest) {
    if (descendants.has(quest.number)) return;
    descendants.add(quest.number);
    childrenByParent.get(quest.number)?.forEach(includeDescendants);
  }

  const visible = new Set<number>();
  for (const quest of quests) {
    if (quest.state !== 'open' && !changed?.has(`issue-${quest.number}`))
      continue;
    includeDescendants(quest);
    let current: Quest | undefined = quest;
    while (current && !visible.has(current.number)) {
      visible.add(current.number);
      current =
        current.parent === undefined ? undefined : byNumber.get(current.parent);
    }
  }
  for (const number of descendants) visible.add(number);
  const priority = (quest: Quest) =>
    alerts.has(quest.stage) ? 2 : activeStages.has(quest.stage) ? 1 : 0;
  const comparePriority = (a: Quest, b: Quest) => priority(b) - priority(a);
  const condensed = visible.size > 16;
  const onMap = new Set(visible);
  if (condensed) {
    onMap.clear();
    const candidates = quests.filter((quest) => visible.has(quest.number));
    const urgent = candidates.filter(
      (quest) => priority(quest) > 0 || changed?.has(`issue-${quest.number}`),
    );
    const urgentNumbers = new Set(urgent.map(({ number }) => number));
    const waiting = candidates.filter(
      (quest) => quest.state === 'open' && !urgentNumbers.has(quest.number),
    );
    for (const quest of [
      ...urgent,
      ...waiting.slice(0, Math.max(0, 12 - urgent.length)),
    ]) {
      let current: Quest | undefined = quest;
      while (current && !onMap.has(current.number)) {
        onMap.add(current.number);
        current =
          current.parent === undefined
            ? undefined
            : byNumber.get(current.parent);
      }
    }
  }
  const roots = quests.filter(
    ({ number, parent }) =>
      onMap.has(number) && (parent === undefined || !onMap.has(parent)),
  );

  if (condensed) roots.sort(comparePriority);

  function render(quest: Quest) {
    const children = (childrenByParent.get(quest.number) ?? []).filter(
      ({ number }) => onMap.has(number),
    );
    if (condensed) children.sort(comparePriority);
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
        />
        {children.length > 0 && (
          <ul
            className="guild-parties"
            aria-label={`보스 몬스터 #${quest.number}의 하위 몬스터`}
          >
            {children.map(render)}
          </ul>
        )}
      </li>
    );
  }

  return (
    <ul className="expeditions" aria-label={label}>
      {roots.map(render)}
      {onMap.size < visible.size && (
        <li className="guild-branch">
          <button className="text-button" onClick={openList}>
            몬스터 목록 보기
          </button>
        </li>
      )}
      {pulls
        .filter((pull) => !pull.merged)
        .map((pull) => (
          <li key={`pr-${pull.number}`}>
            <PullMarker
              pull={pull}
              open={() => openPull(pull)}
              pulse={pulses?.[`pr-${pull.number}`]}
            />
          </li>
        ))}
    </ul>
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
): Promise<T> {
  const response = await fetch(`/api/github?${params}`, {
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = await response.json();
  if (!response.ok)
    throw new RequestError(
      body.error ?? 'GitHub 동기화에 실패했습니다.',
      response.status,
    );
  return body as T;
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

function IssueBadge({ quest }: { quest: Quest }) {
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
      {quest.victory && <Badge stage="complete" />}
      {quest.stage !== 'idle' && quest.stage !== 'complete' ? (
        <Badge stage={quest.stage} />
      ) : quest.state === 'open' && !quest.victory ? (
        <span className="badge idle">몬스터 출현</span>
      ) : null}
    </span>
  );
}

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

function Dialog({
  title,
  className,
  children,
  close,
}: {
  title: string;
  className?: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={className ? `panel dialog ${className}` : 'panel dialog'}
      aria-label={title}
      onCancel={close}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="닫기" onClick={close}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function Reviews({
  region,
  pull,
  token,
}: {
  region: string;
  pull: number;
  token: string;
}) {
  const [reviews, setReviews] = useState<Source[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    request<Source[]>(
      new URLSearchParams({ repo: region, reviews: String(pull) }),
      token,
      controller.signal,
    ).then(setReviews, (cause: Error) => {
      if (!controller.signal.aborted) setError(cause.message);
    });
    return () => controller.abort();
  }, [region, pull, token]);
  if (error) return <p className="fetch-error">{error}</p>;
  if (!reviews) return <p>리뷰 조회 중…</p>;
  return reviews.length ? (
    reviews.map((item, index) => <OutLink key={index} item={item} />)
  ) : (
    <p>GitHub PR 리뷰 기록이 없습니다.</p>
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
  const [reviewPull, setReviewPull] = useState<number>();
  return (
    <Dialog
      title={`${quest.subIssueCount ? '보스 몬스터' : '몬스터'} #${quest.number}`}
      close={close}
    >
      <div className="monster-detail-heading">
        <MonsterGlyph
          boss={Boolean(quest.subIssueCount)}
          defeated={quest.state === 'closed'}
        />
        <h3>{quest.title}</h3>
      </div>
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
      <h4>GitHub 기록</h4>
      <OutLink item={{ title: `Issue #${quest.number}`, url: quest.url }} />
      {quest.pulls.length > 0 && <h4>공략 결과</h4>}
      {quest.pulls.map((item) => (
        <div className="pull-detail" key={item.number}>
          <OutLink
            item={{ ...item, title: `PR #${item.number} · ${item.title}` }}
          />
          <button
            className="text-button"
            onClick={() =>
              setReviewPull(
                reviewPull === item.number ? undefined : item.number,
              )
            }
          >
            <GitPullRequest size={14} />{' '}
            {reviewPull === item.number ? '리뷰 접기' : 'PR 리뷰 조회'}
          </button>
          {reviewPull === item.number && (
            <Reviews
              key={item.number}
              region={region.slug}
              pull={item.number}
              token={token}
            />
          )}
        </div>
      ))}
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
}: {
  pull: PullQuest;
  region: Region;
  token: string;
  close: () => void;
}) {
  const [showReviews, setShowReviews] = useState(false);
  const author = pull.author && agentNames[pull.author];
  const reviewer = pull.reviewer && agentNames[pull.reviewer];
  return (
    <Dialog title={`PR #${pull.number}`} close={close}>
      <h3>{pull.title}</h3>
      <PullStatus pull={pull} />
      {author && <p>작성 · {author}</p>}
      {reviewer && (
        <p>
          리뷰 기록 · {reviewer} {pull.review}
        </p>
      )}
      <OutLink item={{ title: `GitHub PR #${pull.number}`, url: pull.url }} />
      <button
        className="text-button"
        onClick={() => setShowReviews(!showReviews)}
      >
        <GitPullRequest size={14} aria-hidden="true" />{' '}
        {showReviews ? '리뷰 접기' : 'PR 리뷰 조회'}
      </button>
      {showReviews && (
        <Reviews region={region.slug} pull={pull.number} token={token} />
      )}
      {pull.runs.map((run) => (
        <OutLink key={run.url} item={run} />
      ))}
    </Dialog>
  );
}

function PullStatus({ pull }: { pull: PullQuest }) {
  if (pull.stage === 'idle') {
    const Icon = pull.draft ? GitPullRequestDraft : GitPullRequest;
    return (
      <span className="badge idle" role="img" aria-label={pullStatus(pull)}>
        <Icon size={14} aria-hidden="true" />
      </span>
    );
  }
  return alerts.has(pull.stage) ||
    pull.stage === 'ci' ||
    pull.stage === 'complete' ? (
    <Badge stage={pull.stage} />
  ) : (
    <span className={`badge ${pull.stage}`}>{pullStatus(pull)}</span>
  );
}

function RegionDetail({
  region,
  snapshot,
  openQuest,
  openPull,
  remove,
  close,
}: {
  region: Region;
  snapshot?: Snapshot;
  openQuest: (quest: Quest) => void;
  openPull: (pull: PullQuest) => void;
  remove: () => void;
  close: () => void;
}) {
  const quests = snapshot?.report?.quests ?? [];
  const pulls = snapshot?.report?.pullQuests ?? [];
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
          <span>
            <small>
              {children.length || quest.subIssueCount
                ? '보스 몬스터'
                : '몬스터'}{' '}
              #{quest.number}
            </small>
            <strong>{quest.title}</strong>
          </span>
          <AdventurerParty
            members={quest.adventurers ?? []}
            resting={monsterRest(quest)}
          />
          <IssueBadge quest={quest} />
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
  return (
    <Dialog title={region.name} close={close}>
      <OutLink
        item={{
          title: region.slug,
          url: `https://github.com/${region.slug}`,
        }}
      />
      <button className="text-button" onClick={remove}>
        월드맵에서 제거
      </button>
      {snapshot?.error && <p className="fetch-error">{snapshot.error}</p>}
      {!snapshot && <p>왕국 기록을 불러오는 중…</p>}
      {snapshot?.report?.warnings.length ? (
        <p className="fetch-error">
          일부 기록을 확인하지 못했습니다 ·{' '}
          {snapshot.report.warnings.join(', ')}
        </p>
      ) : null}
      {snapshot?.report &&
        (ordered.length ? (
          <ul className="quest-tree">
            {ordered.map((quest) => render(quest))}
          </ul>
        ) : (
          <p>조회 범위에 퀘스트가 없습니다.</p>
        ))}
      {pulls.length > 0 && (
        <>
          <h4>독립 공략 결과</h4>
          <ul className="quest-tree">
            {pulls.map((pull) => (
              <li key={pull.number}>
                <button className="quest-row" onClick={() => openPull(pull)}>
                  <span>
                    <small>PR #{pull.number}</small>
                    <strong>{pull.title}</strong>
                  </span>
                  <PullStatus pull={pull} />
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {!!snapshot?.report?.releases.length && (
        <>
          <h4>왕국 배포 기록</h4>
          {snapshot.report.releases.map((release, index) => (
            <div className="release" key={index}>
              <OutLink item={release} />
              <Badge
                stage={release.stage}
                label={release.stage === 'complete' ? '배포 완료' : undefined}
              />
            </div>
          ))}
        </>
      )}
    </Dialog>
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
        비공개 지역을 탐험하거나 내 API 사용 한도로 조회하려면 읽기 전용 GitHub
        토큰을 연결하세요. 이 브라우저에 저장되며 티켓에서 연결을 해제할 수
        있습니다.
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
        <label htmlFor="github-token">Fine-grained personal access token</label>
        <input
          id="github-token"
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
      <form className="token-form" onSubmit={submit}>
        <label htmlFor="github-repository">GitHub 계정 또는 저장소</label>
        <input
          id="github-repository"
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
      {pending && <p role="status">GitHub 확인 중…</p>}
      {page && (
        <>
          {page.repositories.length ? (
            <fieldset className="repository-options" disabled={pending}>
              <legend>저장소 선택</legend>
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

function App() {
  const [settings, setSettings] = useState(readSettings);
  const { token, repositories } = settings;
  const worldRegions = useMemo(
    () => repositories.map(({ slug }) => repositoryRegion(slug)),
    [repositories],
  );
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
  const [selected, setSelected] = useState<Region>();
  const [selectedQuest, setSelectedQuest] = useState<{
    region: Region;
    number: number;
    kind?: 'pull';
  }>();
  const refresh = useRef<(() => void) | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshInterval = token ? 20_000 : 60_000;
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
    let syncing = false;
    let timer: number | undefined;
    async function sync(force = false) {
      if (syncing || controller.signal.aborted) return;
      window.clearTimeout(timer);
      syncing = true;
      setLoading(true);
      await Promise.all(
        worldRegions.map(async (region) => {
          try {
            const params = new URLSearchParams({ repo: region.slug });
            if (force) params.set('refresh', '1');
            const report = await request<Report>(
              params,
              token,
              controller.signal,
            );
            if (!controller.signal.aborted)
              setSnapshots((current) => ({
                ...current,
                [region.slug]: reportSnapshot(report, current[region.slug]),
              }));
          } catch (error) {
            if (!controller.signal.aborted)
              setSnapshots((current) => ({
                ...current,
                [region.slug]: {
                  ...current[region.slug],
                  error: (error as Error).message,
                  httpStatus:
                    error instanceof RequestError ? error.status : undefined,
                },
              }));
          }
        }),
      );
      syncing = false;
      if (controller.signal.aborted) return;
      setLoading(false);
      if (document.visibilityState === 'visible')
        timer = window.setTimeout(syncVisible, refreshInterval);
    }

    function syncVisible() {
      if (document.visibilityState === 'visible') void sync();
      else window.clearTimeout(timer);
    }

    refresh.current = () => void sync(true);
    void sync();
    document.addEventListener('visibilitychange', syncVisible);
    return () => {
      refresh.current = null;
      document.removeEventListener('visibilitychange', syncVisible);
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
      ? snapshots[selectedQuest.region.slug]?.report?.pullQuests?.find(
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
              <Castle size={22} />
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
            <button
              className="refresh-button"
              aria-label="새로 고침"
              aria-busy={loading}
              data-warning={!loading && partial}
              title={
                !loading && partial
                  ? '일부 GitHub 기록을 확인하지 못했습니다.'
                  : `자동 갱신 ${refreshInterval / 1000}초 간격`
              }
              disabled={loading}
              onClick={() => refresh.current?.()}
            >
              {!loading && (
                <span
                  className="refresh-fill"
                  style={{ animationDuration: `${refreshInterval}ms` }}
                  aria-hidden="true"
                />
              )}
              <RefreshCw
                size={16}
                className={loading ? 'rotate' : ''}
                aria-hidden="true"
              />
            </button>
          </div>
        </header>

        <section className="map-viewport" aria-label="저장소 왕국">
          <div className="world-land">
            <div className="kingdoms">
              {worldRegions.map((region) => {
                const report = snapshots[region.slug]?.report;
                return (
                  <div
                    className="kingdom-area"
                    key={region.slug}
                    style={
                      {
                        '--kingdom-hue': kingdomHue(region.slug),
                      } as CSSProperties
                    }
                  >
                    <button className="kingdom" onClick={() => select(region)}>
                      <Castle
                        className="kingdom-crest"
                        size={34}
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                      <span className="kingdom-label">
                        <strong>{region.name}</strong>
                      </span>
                    </button>
                    {report &&
                    (report.quests.some(
                      ({ state, number }) =>
                        state === 'open' ||
                        snapshots[region.slug]?.changed?.has(`issue-${number}`),
                    ) ||
                      report.pullQuests?.some((item) => !item.merged)) ? (
                      <KingdomMonsters
                        quests={report.quests}
                        pulls={report.pullQuests ?? []}
                        pulses={snapshots[region.slug]?.pulses}
                        changed={snapshots[region.slug]?.changed}
                        openPull={(item) => openPull(region, item)}
                        label={`${region.name} 몬스터와 공략 결과`}
                        openList={() => select(region)}
                        openQuest={(item) =>
                          setSelectedQuest({ region, number: item.number })
                        }
                      />
                    ) : !report ? (
                      <p className="expedition-status">
                        {loading ? '기록 확인 중' : '기록 확인 필요'}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <footer className="world-footer">
          <ul className="expedition-legend" aria-label="기본 파티 구성">
            <li className="actions">
              <Workflow size={14} aria-hidden="true" /> 길드 마스터
            </li>
            <li className="codex">
              <AdventurerGlyph agent="codex" /> Codex
            </li>
            <li className="claude">
              <AdventurerGlyph agent="claude" /> Claude
            </li>
            <li className="release">
              <Rocket size={14} aria-hidden="true" /> 포탈 관리자
            </li>
          </ul>
        </footer>
      </main>
      {selected && (
        <RegionDetail
          key={selected.slug}
          region={selected}
          snapshot={snapshots[selected.slug]}
          openPull={(item) => openPull(selected, item)}
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
      {selectedQuest && pull && (
        <PullDetail
          key={`${selectedQuest.region.slug}-pr-${pull.number}`}
          pull={pull}
          region={selectedQuest.region}
          token={token}
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
