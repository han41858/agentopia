import { objectSizes } from './object-sizes.ts';
import { WorldArt } from './world-art.tsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, RefreshCw, Ticket } from 'lucide-react';
import { repositoryRegion } from '../server/model.ts';
import type { PullQuest, Region, Report } from '../server/model.ts';
import {
  AdventurerGlyph,
  PartyLeaderGlyph,
  PortalKeeperGlyph,
} from './characters.tsx';
import { nextRefreshInterval, refreshDue } from './refresh.ts';
import { isCurrentFacility } from './facility-kind.ts';
import { HeritageArc } from './heritage-arc.tsx';
import type { Heritage } from '../server/heritage.ts';
import { GitHubUsage } from './github-usage.tsx';
import { KingdomWall } from './kingdom-wall.tsx';
import type { RefreshConsumption } from '../server/github-debug.ts';
import { BranchRoadMap, placeBranchRoads } from './branch-road-map.tsx';
import type { RoadSelection } from './branch-road-map.tsx';
import {
  reportForges,
  partyStates,
  reportSnapshot,
  activeStages,
} from './snapshot.ts';
import type { Snapshot } from './snapshot.ts';
import {
  getTokenStatus,
  legacyRepositoryListKey,
  settingsVersion,
  settingsKey,
  readSettings,
} from './settings.ts';
import { RequestError, request, requestHeritage } from './request.ts';
import { kingdomHue, FacilityMarker, KingdomMonsters } from './map-markers.tsx';
import type { MapEntry } from './map-markers.tsx';
import { OutLink, Dialog } from './dialog.tsx';
import {
  QuestDetail,
  PullDetail,
  PlazaDetail,
  RegionDetail,
  HeritageDetail,
} from './detail-dialogs.tsx';
import type { HeritageSelection } from './detail-dialogs.tsx';
import { TokenDialog, RepositoryDialog } from './settings-dialogs.tsx';
import './styles.css';

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
