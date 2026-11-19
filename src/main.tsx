import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Castle,
  Crown,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  ExternalLink,
  Flag,
  GitPullRequest,
  Hourglass,
  KeyRound,
  Plus,
  RefreshCw,
  Rocket,
  ScrollText,
  Shield,
  Sparkles,
  Swords,
  Ticket,
  TriangleAlert,
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
import './styles.css';

type Snapshot = { report?: Report; error?: string; httpStatus?: number };

function getTokenStatus(hasData: boolean, snapshot?: Snapshot) {
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
  return {
    label: '토큰 확인 중',
    description: 'GitHub에서 토큰의 저장소 접근을 확인하고 있습니다.',
    tone: 'checking',
  };
}
const activeStages = new Set<Stage>([
  'queued',
  'developing',
  'reviewing',
  'ci',
  'deploying',
  'merging',
]);
const alerts = new Set<Stage>(['failed', 'attention']);
const defaultRegion: Region = {
  ...repositoryRegion('han41858/agentopia'),
  name: 'Agentopia',
};
const repositoryListKey = 'agentopia.public-repositories';

function readRepositories(): Repository[] {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(repositoryListKey) ?? '[]',
    );
    if (!Array.isArray(stored)) return [];
    const slugs = new Set<string>();
    for (const item of stored) {
      const slug = typeof item === 'string' ? repositorySlug(item) : undefined;
      if (slug && slug !== defaultRegion.slug) slugs.add(slug);
    }
    return Array.from(slugs, (slug) => ({ slug, private: false }));
  } catch {
    return [];
  }
}
const glyph = {
  idle: Clock3,
  queued: Hourglass,
  developing: Swords,
  reviewing: ScrollText,
  ci: Shield,
  deploying: Rocket,
  merging: GitPullRequest,
  complete: Check,
  failed: TriangleAlert,
  attention: Flag,
};

const partyRoles = [
  { name: 'GitHub Actions', Icon: Workflow, color: 'actions' },
  { name: 'Codex', Icon: Code2, color: 'codex' },
  { name: 'Claude', Icon: Sparkles, color: 'claude' },
  { name: 'Release', Icon: Rocket, color: 'release' },
] as const;

function expeditionActivity(quest: Quest): {
  role?: (typeof partyRoles)[number]['color'];
  action: string;
} {
  switch (quest.stage) {
    case 'queued':
      return { role: 'actions', action: '워크플로 대기' };
    case 'developing':
      return { role: quest.developer, action: '개발 중' };
    case 'reviewing':
      return { role: quest.reviewer, action: '코드 리뷰 중' };
    case 'ci':
      return { role: 'actions', action: 'CI 검사 중' };
    case 'merging':
      return { role: 'actions', action: 'PR 병합 중' };
    case 'deploying':
      return { role: 'release', action: '배포 중' };
    default:
      return { action: stages[quest.stage] };
  }
}

function closedIssueLabel(quest: Quest) {
  const completed = quest.stateReason
    ? quest.stateReason === 'completed'
    : quest.stage === 'complete';
  return completed ? '완료' : '닫힘';
}

function Expedition({ quest, open }: { quest: Quest; open: () => void }) {
  const closed = quest.state === 'closed';
  const blocked = !closed && alerts.has(quest.stage);
  const underway = !closed && activeStages.has(quest.stage);
  const StatusIcon = closed ? Check : glyph[quest.stage];
  const activity = expeditionActivity(quest);
  const role = underway ? activity.role : undefined;
  const action = closed ? closedIssueLabel(quest) : activity.action;
  const actor = underway
    ? (partyRoles.find(({ color }) => color === role)?.name ?? '담당 미확인')
    : undefined;

  const status = actor ? `${actor} · ${action}` : action;

  return (
    <button
      className={`expedition${blocked ? ' blocked' : ''}${underway ? ' underway' : ''}${closed ? ' closed-issue' : ''}`}
      aria-label={`이슈 #${quest.number} 파티 · ${quest.title} · ${status}`}
      title={blocked ? quest.title : `${quest.title} · ${status}`}
      onClick={open}
    >
      <span className="expedition-party" aria-hidden="true">
        {partyRoles.map(({ name, Icon, color }) => (
          <span
            className={`role-symbol ${color}${color === role ? ' current-role' : ''}`}
            key={name}
          >
            <Icon size={14} />
          </span>
        ))}
      </span>
      <small className="expedition-number">
        <StatusIcon size={blocked ? 13 : 11} aria-hidden="true" /> #
        {quest.number}
      </small>
      {closed && <small className="expedition-status-label">{action}</small>}
    </button>
  );
}

function pullStatus(pull: PullQuest) {
  if (pull.stage === 'ci') return 'CI 검사 중';
  if (pull.stage !== 'idle') return stages[pull.stage];
  return pull.draft ? '초안' : 'PR 열림';
}

function pullActivity(pull: PullQuest) {
  if (pull.reviewer)
    return `${partyRoles.find(({ color }) => color === pull.reviewer)?.name} 리뷰 기록`;
  if (pull.author)
    return `${partyRoles.find(({ color }) => color === pull.author)?.name} 작성`;
  return undefined;
}

function PullMarker({ pull, open }: { pull: PullQuest; open: () => void }) {
  const role = partyRoles.find(
    ({ color }) => color === (pull.reviewer ?? pull.author),
  );
  const Icon = role?.Icon ?? GitPullRequest;
  const label = [
    `PR #${pull.number}`,
    pull.title,
    pullActivity(pull),
    pullStatus(pull),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <button
      className={`expedition pull-marker${alerts.has(pull.stage) ? ' blocked' : ''}`}
      title={alerts.has(pull.stage) ? pull.title : label}
      aria-label={label}
      onClick={open}
    >
      <span
        className={`role-symbol current-role${role ? ` ${role.color}` : ''}`}
      >
        <Icon size={15} aria-hidden="true" />
      </span>
      <small className="expedition-number">PR #{pull.number}</small>
      {alerts.has(pull.stage) ? (
        <Badge stage={pull.stage} />
      ) : (
        <small className="expedition-status-label">{pullStatus(pull)}</small>
      )}
    </button>
  );
}

function GuildQuests({
  quests,
  pulls,
  label,
  openQuest,
  openPull,
}: {
  quests: Quest[];
  pulls: PullQuest[];
  label: string;
  openQuest: (quest: Quest) => void;
  openPull: (pull: PullQuest) => void;
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
    if (quest.state !== 'open') continue;
    includeDescendants(quest);
    let current: Quest | undefined = quest;
    while (current && !visible.has(current.number)) {
      visible.add(current.number);
      current =
        current.parent === undefined ? undefined : byNumber.get(current.parent);
    }
  }
  for (const number of descendants) visible.add(number);
  const roots = quests.filter(
    ({ number, parent }) =>
      visible.has(number) && (parent === undefined || !visible.has(parent)),
  );

  function render(quest: Quest) {
    const children = (childrenByParent.get(quest.number) ?? []).filter(
      ({ number }) => visible.has(number),
    );
    const guildLeader = children.length > 0 || Boolean(quest.subIssueCount);
    return (
      <li
        key={quest.number}
        className={guildLeader ? 'guild-branch' : undefined}
      >
        {guildLeader ? (
          <button
            className="guild-leader"
            title={quest.title}
            aria-label={`길드장 #${quest.number} · ${quest.title}`}
            onClick={() => openQuest(quest)}
          >
            <span>
              <Crown size={17} aria-hidden="true" /> #{quest.number}
            </span>
          </button>
        ) : (
          <Expedition quest={quest} open={() => openQuest(quest)} />
        )}
        {children.length > 0 && (
          <ul
            className="guild-parties"
            aria-label={`길드장 #${quest.number}의 하위 이슈`}
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
      {pulls.map((pull) => (
        <li key={`pr-${pull.number}`}>
          <PullMarker pull={pull} open={() => openPull(pull)} />
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

function Badge({ stage }: { stage: Stage }) {
  const Icon = glyph[stage];
  if (alerts.has(stage)) {
    return (
      <span className={`badge ${stage}`} role="img" aria-label={stages[stage]}>
        <Icon size={14} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={`badge ${stage}`}>
      <Icon size={14} aria-hidden="true" />
      {stages[stage]}
    </span>
  );
}

function IssueBadge({ quest }: { quest: Quest }) {
  if (quest.state !== 'closed') return <Badge stage={quest.stage} />;
  const label = closedIssueLabel(quest);
  return (
    <span className={`badge${label === '완료' ? ' complete' : ''}`}>
      {label}
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

function Party({ quest }: { quest: Quest }) {
  const activeRole =
    quest.state === 'open' ? expeditionActivity(quest).role : undefined;
  const roles = [
    {
      name: '파티장',
      sprite: 'guild',
      duty: 'GitHub Actions',
      running: activeRole === 'actions',
    },
    {
      name: '마법공학자',
      sprite: 'codex',
      duty: quest.developer === 'codex' ? 'Codex · 개발' : 'Codex · 리뷰',
      visible: quest.developer === 'codex' || quest.reviewer === 'codex',
      running: activeRole === 'codex',
    },
    {
      name: '현자',
      sprite: 'claude',
      duty: quest.developer === 'claude' ? 'Claude · 개발' : 'Claude · 리뷰',
      visible: quest.developer === 'claude' || quest.reviewer === 'claude',
      running: activeRole === 'claude',
    },
    {
      name: '수호 골렘',
      sprite: 'golem',
      duty: 'CI',
      visible: quest.runs.some((item) => item.title === 'CI'),
      running: quest.state === 'open' && quest.stage === 'ci',
    },
    {
      name: '포탈 관리자',
      sprite: 'portal',
      duty:
        activeRole === 'release' ? 'Release · 배포 중' : 'Release · 배포 담당',
      running: activeRole === 'release',
    },
  ];
  const members = roles.filter(({ visible }) => visible !== false);
  return (
    <div className="party">
      {members.map(({ name, sprite, duty, running }) => (
        <div key={name}>
          <span
            className={`sprite ${sprite} ${running ? 'working' : ''}`}
            aria-hidden="true"
          />
          <span>
            <strong>{name}</strong>
            <small>{duty}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function PartyPreview({ quest }: { quest: Quest }) {
  const cast = [quest.developer, quest.reviewer].filter(
    (agent) => agent !== undefined,
  );
  if (quest.stage === 'ci')
    return <span className="sprite golem working" aria-hidden="true" />;
  if (quest.stage === 'deploying')
    return <span className="sprite portal working" aria-hidden="true" />;
  if (!cast.length)
    return quest.runs.length ? (
      <span className="sprite guild" aria-hidden="true" />
    ) : null;
  const current =
    quest.stage === 'developing'
      ? quest.developer
      : quest.stage === 'reviewing'
        ? quest.reviewer
        : undefined;
  return (
    <span className="party-preview" aria-hidden="true">
      {cast.map((agent) => (
        <span
          key={agent}
          className={`sprite ${agent} ${agent === current ? 'working' : ''}`}
        />
      ))}
    </span>
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
    <Dialog title={`Quest #${quest.number}`} close={close}>
      <h3>{quest.title}</h3>
      <IssueBadge quest={quest} />
      {(quest.reason || quest.detail) && (
        <div className={`reason ${alerts.has(quest.stage) ? 'danger' : ''}`}>
          <p>{quest.reason}</p>
          {quest.detail && <p>{quest.detail}</p>}
        </div>
      )}
      {quest.evidence && <OutLink item={quest.evidence} />}
      <h4>개발 파티</h4>
      <Party quest={quest} />
      {quest.review && (
        <p>
          현재 커밋의 AI 리뷰 결과 <strong>{quest.review}</strong>
        </p>
      )}
      <h4>GitHub 기록</h4>
      <OutLink item={{ title: `Issue #${quest.number}`, url: quest.url }} />
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
  const author = partyRoles.find(({ color }) => color === pull.author);
  const reviewer = partyRoles.find(({ color }) => color === pull.reviewer);
  return (
    <Dialog title={`PR #${pull.number}`} close={close}>
      <h3>{pull.title}</h3>
      <PullStatus pull={pull} />
      {author && <p>작성 · {author.name}</p>}
      {reviewer && (
        <p>
          리뷰 기록 · {reviewer.name} {pull.review}
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
  return pull.stage === 'attention' || pull.stage === 'failed' ? (
    <Badge stage={pull.stage} />
  ) : (
    <span className={`badge ${pull.stage}`}>{pullStatus(pull)}</span>
  );
}

function RegionDetail({
  region,
  snapshot,
  openQuest,
  remove,
  close,
}: {
  region: Region;
  snapshot?: Snapshot;
  openQuest: (quest: Quest) => void;
  remove?: () => void;
  close: () => void;
}) {
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
          <span>
            <small>
              {children.length || quest.subIssueCount
                ? '길드장'
                : quest.parent
                  ? '하위 이슈 파티'
                  : '퀘스트'}{' '}
              #{quest.number}
            </small>
            <strong>{quest.title}</strong>
            {quest.developer && (
              <small>
                {quest.developer} · 개발
                {quest.reviewer && ` / ${quest.reviewer} · 리뷰`}
              </small>
            )}
          </span>
          <PartyPreview quest={quest} />
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
      <p>{region.description}</p>
      <OutLink
        item={{
          title: 'GitHub 저장소',
          url: `https://github.com/${region.slug}`,
        }}
      />
      {remove && (
        <button className="text-button" onClick={remove}>
          월드맵에서 제거
        </button>
      )}
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
      {!!snapshot?.report?.releases.length && (
        <>
          <h4>왕국 배포 기록</h4>
          {snapshot.report.releases.map((release, index) => (
            <div className="release" key={index}>
              <OutLink item={release} />
              <Badge stage={release.stage} />
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
        토큰을 연결하세요. 토큰은 현재 탭이 열린 동안에만 사용됩니다.
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

function QuestLog({
  regions,
  snapshots,
  loading,
  openQuest,
  openPull,
}: {
  regions: Region[];
  snapshots: Record<string, Snapshot>;
  loading: boolean;
  openQuest: (region: Region, quest: Quest) => void;
  openPull: (region: Region, pull: PullQuest) => void;
}) {
  const entries = regions
    .flatMap((region) => {
      const report = snapshots[region.id]?.report;
      const items: (Quest | PullQuest)[] = [
        ...(report?.quests ?? []),
        ...(report?.pullQuests ?? []),
      ];
      return items.map((item) => ({ region, item }));
    })
    .sort(
      (a, b) =>
        Number('state' in a.item && a.item.state === 'closed') -
          Number('state' in b.item && b.item.state === 'closed') ||
        b.item.number - a.item.number ||
        a.region.slug.localeCompare(b.region.slug),
    );
  const hasReport = regions.some(({ id }) => snapshots[id]?.report);

  return (
    <section className="panel quest-log" aria-labelledby="quest-log-title">
      <h2 id="quest-log-title">
        <ScrollText size={15} aria-hidden="true" /> 퀘스트
      </h2>
      {entries.length ? (
        <ul className="quest-log-list">
          {entries.map(({ region, item }) => {
            const issue = 'state' in item;
            return (
              <li
                key={`${region.slug}:${issue ? 'issue' : 'pr'}:${item.number}`}
              >
                <button
                  className="quest-log-row"
                  onClick={() =>
                    issue ? openQuest(region, item) : openPull(region, item)
                  }
                >
                  <small>
                    {region.name} · {issue ? '' : 'PR '}#{item.number}
                  </small>
                  <strong>{item.title}</strong>
                  {issue ? (
                    <IssueBadge quest={item} />
                  ) : (
                    <PullStatus pull={item} />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p>
          {hasReport
            ? '조회된 이슈·PR 없음'
            : loading
              ? '이슈·PR 불러오는 중'
              : '이슈·PR 조회 필요'}
        </p>
      )}
    </section>
  );
}

function App() {
  const [token, storeToken] = useState('');
  const [repositories, setRepositories] = useState(readRepositories);
  const worldRegions = useMemo(
    () => [
      defaultRegion,
      ...repositories.map(({ slug }) => repositoryRegion(slug)),
    ],
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
      const publicSlugs = repositories
        .filter((repo) => !repo.private)
        .map(({ slug }) => slug);
      localStorage.setItem(repositoryListKey, JSON.stringify(publicSlugs));
    } catch {
      // The current tab can still use the list when storage is unavailable.
    }
  }, [repositories]);

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
                [region.id]: { report },
              }));
          } catch (error) {
            if (!controller.signal.aborted)
              setSnapshots((current) => ({
                ...current,
                [region.id]: {
                  ...current[region.id],
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
    storeToken(value);
    setRepositories((items) => items.filter((repo) => !repo.private));
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
    setRepositories((items) =>
      items.filter(({ slug }) => slug !== region.slug),
    );
    setSnapshots((current) => {
      const remaining = { ...current };
      delete remaining[region.id];
      return remaining;
    });
    setSelected(undefined);
    setSelectedQuest(undefined);
  }

  const hasData = worldRegions.some(({ id }) => snapshots[id]?.report);
  const tokenStatus = getTokenStatus(
    hasData,
    Object.values(snapshots).find(({ error }) => error),
  );
  const partial = worldRegions.some(
    ({ id }) =>
      !snapshots[id]?.report ||
      snapshots[id].error ||
      snapshots[id].report?.warnings.length,
  );
  const quest =
    selectedQuest &&
    selectedQuest.kind !== 'pull' &&
    snapshots[selectedQuest.region.id]?.report?.quests.find(
      ({ number }) => number === selectedQuest.number,
    );
  const pull =
    selectedQuest?.kind === 'pull'
      ? snapshots[selectedQuest.region.id]?.report?.pullQuests?.find(
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
            <div>
              <p className="brand">Agentopia</p>
              <h1 id="world-title">월드맵</h1>
            </div>
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
          <div className="kingdoms">
            {worldRegions.map((region) => {
              const report = snapshots[region.id]?.report;
              return (
                <div className={`kingdom-area ${region.theme}`} key={region.id}>
                  <button className="kingdom" onClick={() => select(region)}>
                    <span className="kingdom-land" aria-hidden="true">
                      <Castle size={34} strokeWidth={1.5} />
                    </span>
                    <span className="kingdom-label">
                      <strong>{region.name}</strong>
                    </span>
                  </button>
                  {report &&
                  (report.quests.some(({ state }) => state === 'open') ||
                    report.pullQuests?.length) ? (
                    <GuildQuests
                      quests={report.quests}
                      pulls={report.pullQuests ?? []}
                      openPull={(item) => openPull(region, item)}
                      label={`${region.name} 이슈`}
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
        </section>

        <footer className="world-footer">
          <QuestLog
            regions={worldRegions}
            snapshots={snapshots}
            loading={loading}
            openPull={openPull}
            openQuest={(region, item) =>
              setSelectedQuest({ region, number: item.number })
            }
          />
          <ul className="expedition-legend" aria-label="기본 파티 구성">
            {partyRoles.map(({ name, Icon, color }) => (
              <li className={color} key={name}>
                <Icon size={14} aria-hidden="true" /> {name}
              </li>
            ))}
          </ul>
        </footer>
      </main>
      {selected && (
        <RegionDetail
          key={selected.id}
          region={selected}
          snapshot={snapshots[selected.id]}
          openQuest={(item) =>
            setSelectedQuest({ region: selected, number: item.number })
          }
          remove={
            selected.slug === defaultRegion.slug
              ? undefined
              : () => removeRegion(selected)
          }
          close={() => setSelected(undefined)}
        />
      )}
      {showAdd && (
        <RepositoryDialog
          token={token}
          regions={worldRegions}
          added={(repos) => setRepositories((items) => [...items, ...repos])}
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
          key={`${selectedQuest.region.id}-pr-${pull.number}`}
          pull={pull}
          region={selectedQuest.region}
          token={token}
          close={() => setSelectedQuest(undefined)}
        />
      )}
      {selectedQuest && quest && (
        <QuestDetail
          key={`${selectedQuest.region.id}-${quest.number}`}
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
