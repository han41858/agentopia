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
  regions,
  repositoryInput,
  repositoryRegion,
  repositorySlug,
  stages,
} from '../server/model.ts';
import type {
  Quest,
  Region,
  Report,
  Repository,
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
const defaultRegion = regions[0];
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
      title={`${quest.title} · ${status}`}
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
        <StatusIcon size={11} aria-hidden="true" /> #{quest.number}
      </small>
      {(closed || blocked) && (
        <small className="expedition-status-label">{action}</small>
      )}
    </button>
  );
}

function GuildQuests({
  quests,
  label,
  openQuest,
}: {
  quests: Quest[];
  label: string;
  openQuest: (quest: Quest) => void;
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
          <button className="guild-leader" onClick={() => openQuest(quest)}>
            <span>
              <Crown size={17} aria-hidden="true" /> 길드장 #{quest.number}
            </span>
            <span>{quest.title}</span>
            <small>
              {quest.state === 'closed'
                ? closedIssueLabel(quest)
                : stages[quest.stage]}
            </small>
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
  return (
    <span className={`badge ${stage}`}>
      <Icon size={14} />
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
  children,
  close,
}: {
  title: string;
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
      className="panel dialog"
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
  close,
}: {
  token: string;
  status: ReturnType<typeof getTokenStatus>;
  setToken: (token: string) => void;
  close: () => void;
}) {
  const [value, setValue] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (value.trim()) setToken(value.trim());
    close();
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
  added: (repo: Repository) => void;
  select: (region: Region) => void;
  close: () => void;
}) {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const requestController = useRef<AbortController>(null);
  useEffect(() => () => requestController.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestController.current) return;
    const slug = repositoryInput(value);
    if (!slug) {
      setError('owner/repo 또는 GitHub 저장소 주소를 입력하세요.');
      return;
    }
    const existing = regions.find((region) => region.slug === slug);
    if (existing) {
      select(existing);
      close();
      return;
    }
    const controller = new AbortController();
    requestController.current = controller;
    setError('');
    setPending(true);
    try {
      const repo = await request<Repository>(
        new URLSearchParams({ repo: slug, repository: '1' }),
        token,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const match = regions.find((region) => region.slug === repo.slug);
      if (match) select(match);
      else added(repo);
      close();
    } catch (cause) {
      if (!controller.signal.aborted) setError((cause as Error).message);
    } finally {
      requestController.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return (
    <Dialog title="저장소 추가" close={close}>
      <form className="token-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor="github-repository">GitHub 저장소</label>
        <input
          id="github-repository"
          placeholder="owner/repo"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          required
        />
        {error && (
          <p className="fetch-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="submit" disabled={pending}>
          <Plus size={16} aria-hidden="true" />
          {pending ? '접근 확인 중…' : '추가'}
        </button>
      </form>
    </Dialog>
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
    snapshots[selectedQuest.region.id]?.report?.quests.find(
      ({ number }) => number === selectedQuest.number,
    );

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
            {worldRegions.map((region) => (
              <div className={`kingdom-area ${region.theme}`} key={region.id}>
                <button className="kingdom" onClick={() => select(region)}>
                  <span className="kingdom-land" aria-hidden="true">
                    <Castle size={34} strokeWidth={1.5} />
                  </span>
                  <span className="kingdom-label">
                    <strong>{region.name}</strong>
                    <small>{region.title}</small>
                  </span>
                </button>
                {snapshots[region.id]?.report?.quests.some(
                  ({ state }) => state === 'open',
                ) ? (
                  <GuildQuests
                    quests={snapshots[region.id].report!.quests}
                    label={`${region.name} 이슈`}
                    openQuest={(item) =>
                      setSelectedQuest({ region, number: item.number })
                    }
                  />
                ) : (
                  <p className="expedition-status">
                    {snapshots[region.id]?.report
                      ? '열린 이슈 없음'
                      : loading
                        ? '기록 확인 중'
                        : '기록 확인 필요'}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>

        <footer className="world-footer">
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
          added={(repo) => setRepositories((items) => [...items, repo])}
          select={select}
          close={() => setShowAdd(false)}
        />
      )}
      {showConnect && (
        <TokenDialog
          token={token}
          status={tokenStatus}
          setToken={setToken}
          close={() => setShowConnect(false)}
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
