import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Castle,
  Check,
  ChevronUp,
  ChevronRight,
  Clock3,
  Code2,
  ExternalLink,
  Flag,
  GitPullRequest,
  GitFork as Github,
  Hourglass,
  KeyRound,
  RefreshCw,
  Rocket,
  ScrollText,
  Shield,
  Sparkles,
  Swords,
  TriangleAlert,
  Workflow,
  X,
} from 'lucide-react';
import { regions, stages } from '../server/model.ts';
import type { Quest, Region, Report, Source, Stage } from '../server/model.ts';
import './styles.css';

type Snapshot = { report?: Report; error?: string };
const activeStages = new Set<Stage>([
  'queued',
  'developing',
  'reviewing',
  'ci',
  'deploying',
  'merging',
]);
const alerts = new Set<Stage>(['failed', 'attention']);
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

function Expedition({ quest, open }: { quest: Quest; open: () => void }) {
  return (
    <button
      className="expedition"
      aria-label={`이슈 #${quest.number} 파티 · ${quest.title}`}
      title={quest.title}
      onClick={open}
    >
      <ChevronUp className="expedition-route" size={17} aria-hidden="true" />
      <span className="expedition-party" aria-hidden="true">
        {partyRoles.map(({ name, Icon, color }) => (
          <span className={`role-symbol ${color}`} key={name}>
            <Icon size={14} />
          </span>
        ))}
      </span>
      <small>이슈 #{quest.number}</small>
    </button>
  );
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
    throw new Error(body.error ?? 'GitHub 동기화에 실패했습니다.');
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
      new URLSearchParams({ region, reviews: String(pull) }),
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
  const roles = [
    {
      name: '길드 마스터',
      sprite: 'guild',
      duty: 'GitHub Actions',
      visible: quest.runs.length > 0,
      running: quest.stage === 'queued',
    },
    {
      name: '마법공학자',
      sprite: 'codex',
      duty: quest.developer === 'codex' ? 'Codex · 개발' : 'Codex · 리뷰',
      visible: quest.developer === 'codex' || quest.reviewer === 'codex',
      running:
        (quest.stage === 'developing' && quest.developer === 'codex') ||
        (quest.stage === 'reviewing' && quest.reviewer === 'codex'),
    },
    {
      name: '현자',
      sprite: 'claude',
      duty: quest.developer === 'claude' ? 'Claude · 개발' : 'Claude · 리뷰',
      visible: quest.developer === 'claude' || quest.reviewer === 'claude',
      running:
        (quest.stage === 'developing' && quest.developer === 'claude') ||
        (quest.stage === 'reviewing' && quest.reviewer === 'claude'),
    },
    {
      name: '수호 골렘',
      sprite: 'golem',
      duty: 'CI',
      visible: quest.runs.some((item) => item.title === 'CI'),
      running: quest.stage === 'ci',
    },
    {
      name: '포탈 관리자',
      sprite: 'portal',
      duty: 'Release',
      visible: quest.stage === 'deploying',
      running: quest.stage === 'deploying',
    },
  ];
  const known = roles.filter(({ visible }) => visible);
  return known.length ? (
    <div className="party">
      {known.map(({ name, sprite, duty, running }) => (
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
  ) : (
    <p>확인된 파티 정보가 없습니다.</p>
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
      <Badge stage={quest.stage} />
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
              region={region.id}
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
  close,
}: {
  region: Region;
  snapshot?: Snapshot;
  openQuest: (quest: Quest) => void;
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
              {quest.parent
                ? '하위 퀘스트'
                : children.length
                  ? '메인 퀘스트'
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
          <Badge stage={quest.stage} />
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
          url: `https://github.com/han41858/${region.id}`,
        }}
      />
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
  setToken,
  close,
}: {
  token: string;
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

function App() {
  const [token, storeToken] = useState('');
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
  const [selected, setSelected] = useState<Region>();
  const [selectedQuest, setSelectedQuest] = useState<{
    region: Region;
    number: number;
  }>();
  const [revision, refresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showConnect, setShowConnect] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function sync() {
      setLoading(true);
      await Promise.all(
        regions.map(async (region) => {
          try {
            const report = await request<Report>(
              new URLSearchParams({ region: region.id }),
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
                },
              }));
          }
        }),
      );
      if (!controller.signal.aborted) setLoading(false);
    }
    void sync();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void sync();
    }, 5 * 60_000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [token, revision]);

  function setToken(value: string) {
    if (value === token) return;
    storeToken(value);
    setSnapshots({});
    setSelectedQuest(undefined);
    setLoading(true);
  }

  function select(region: Region) {
    setSelected(region);
    setSelectedQuest(undefined);
  }

  const activeQuests = Object.fromEntries(
    regions.map(({ id }) => [
      id,
      (snapshots[id]?.report?.quests ?? []).filter(({ stage }) =>
        activeStages.has(stage),
      ),
    ]),
  );
  const active = Object.values(activeQuests).reduce(
    (sum, quests) => sum + quests.length,
    0,
  );
  const rescue = regions
    .flatMap(({ id }) => snapshots[id]?.report?.quests ?? [])
    .filter((quest) => alerts.has(quest.stage)).length;
  const hasData = regions.some(({ id }) => snapshots[id]?.report);
  const partial = regions.some(
    ({ id }) =>
      !snapshots[id]?.report ||
      snapshots[id].error ||
      snapshots[id].report?.warnings.length,
  );
  const updated = regions
    .map(({ id }) => snapshots[id]?.report?.updatedAt ?? '')
    .sort()
    .at(-1);
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
          <button className="connect" onClick={() => setShowConnect(true)}>
            <Github size={17} />
            <span>{token ? 'GitHub 토큰 관리' : 'GitHub 연결'}</span>
          </button>
        </header>

        <section className="map-viewport" aria-label="저장소 왕국">
          <div className="kingdoms">
            {regions.map((region) => (
              <div className={`kingdom-area ${region.theme}`} key={region.id}>
                <button className="kingdom" onClick={() => select(region)}>
                  <span className="kingdom-land" aria-hidden="true">
                    <Castle size={34} strokeWidth={1.5} />
                  </span>
                  <span className="kingdom-label">
                    <strong>{region.name}</strong>
                    <small>{region.title}</small>
                    {snapshots[region.id]?.report?.quests.some(({ stage }) =>
                      alerts.has(stage),
                    ) && (
                      <TriangleAlert
                        className="kingdom-alert"
                        size={16}
                        aria-label="구조 요청 있음"
                      />
                    )}
                  </span>
                </button>
                {activeQuests[region.id].length ? (
                  <ul
                    className="expeditions"
                    aria-label={`${region.name} 출정 파티`}
                  >
                    {activeQuests[region.id].map((item) => (
                      <li key={item.number}>
                        <Expedition
                          quest={item}
                          open={() =>
                            setSelectedQuest({ region, number: item.number })
                          }
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="expedition-status">
                    {snapshots[region.id]?.report
                      ? '파티 대기'
                      : loading
                        ? '기록 확인 중'
                        : '기록 확인 필요'}
                  </p>
                )}
              </div>
            ))}
          </div>
          <ul className="expedition-legend" aria-label="기본 파티 구성">
            {partyRoles.map(({ name, Icon, color }) => (
              <li className={color} key={name}>
                <Icon size={14} aria-hidden="true" /> {name}
              </li>
            ))}
          </ul>
        </section>

        <div className="world-footer">
          <div className="world-summary" aria-label="월드 현황">
            <span>
              왕국 <strong>{regions.length}</strong>
            </span>
            <span>
              진행 중 <strong>{hasData ? active : '—'}</strong>
            </span>
            <span>
              구조 요청 <strong>{hasData ? rescue : '—'}</strong>
            </span>
          </div>
          <footer className="map-footer">
            <span>
              <span
                className={`signal ${hasData && !partial ? 'online' : ''}`}
              />{' '}
              {loading
                ? '동기화 중'
                : !hasData
                  ? 'GitHub 데이터 확인 필요'
                  : partial
                    ? '일부 데이터 조회'
                    : 'GitHub 데이터 동기화됨'}
              {updated && (
                <time dateTime={updated}>
                  {' '}
                  ·{' '}
                  {new Date(updated).toLocaleTimeString('ko-KR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              )}
            </span>
            <button
              className="text-button"
              disabled={loading}
              onClick={() => refresh((count) => count + 1)}
            >
              <RefreshCw size={14} className={loading ? 'rotate' : ''} /> 새로
              고침
            </button>
          </footer>
        </div>
      </main>
      {selected && (
        <RegionDetail
          key={selected.id}
          region={selected}
          snapshot={snapshots[selected.id]}
          openQuest={(item) =>
            setSelectedQuest({ region: selected, number: item.number })
          }
          close={() => setSelected(undefined)}
        />
      )}
      {showConnect && (
        <TokenDialog
          token={token}
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
