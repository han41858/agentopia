import {
  DisplayModeProvider,
  ModeSwitch,
  useDisplayMode,
} from './display-mode.tsx';
import { WorldArt } from './world-art.tsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Ticket,
} from 'lucide-react';
import { repositoryRegion } from '../server/model.ts';
import type { PullQuest, Region, Report } from '../server/model.ts';
import { AdventurerGlyph, PartyLeaderGlyph } from './characters.tsx';
import type { Heritage } from '../server/heritage.ts';
import { GitHubUsage } from './github-usage.tsx';
import { placeBranchRoads } from './branch-road-map.tsx';
import type { RoadPlacement } from './branch-road-map.tsx';
import { reportForges } from './snapshot.ts';
import type { Snapshot } from './snapshot.ts';
import {
  getTokenStatus,
  legacyRepositoryListKey,
  settingsVersion,
  settingsKey,
  readSettings,
} from './settings.ts';
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
import { KingdomRegion } from './kingdom-region.tsx';
import type { RoadTarget } from './kingdom-region.tsx';
import { useRegionRefresh } from './use-region-refresh.ts';
import type { RefreshJobs, RefreshUsage } from './use-region-refresh.ts';
import './styles.css';

const narrowHeaderQuery = '(max-width: 640px)';

function App() {
  const isSimple = useDisplayMode() === 'simple';
  const [settings, setSettings] = useState(readSettings);
  const { token, repositories } = settings;
  const worldRegions = useMemo(
    () => repositories.map(({ slug }) => repositoryRegion(slug)),
    [repositories],
  );
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
  const [selected, setSelected] = useState<Region>();
  const [selectedQuest, setSelectedQuest] = useState<MapEntry>();
  const [refreshUsage, setRefreshUsage] = useState<RefreshUsage>();
  const [selectedRoad, setSelectedRoad] = useState<RoadTarget>();
  const [selectedHeritage, setSelectedHeritage] = useState<HeritageSelection>();
  const [inspected, setInspected] = useState<MapEntry>();
  const updateSelectedHeritage = useCallback((slug: string, data: Heritage) => {
    setSelectedHeritage((current) => {
      if (!current || current.region.slug !== slug) return current;
      const record = data[current.metric];
      return record ? { ...current, record } : current;
    });
  }, []);
  const inspect = useCallback((entry: MapEntry, active: boolean) => {
    setInspected((current) =>
      active
        ? entry
        : current?.region.slug === entry.region.slug &&
            current.number === entry.number &&
            current.kind === entry.kind
          ? undefined
          : current,
    );
  }, []);
  const refresh = useRef<(() => void) | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshInterval = token ? 20_000 : 60_000;
  const [progress, setProgress] = useState({
    duration: refreshInterval,
    key: 0,
  });
  const refreshJobs = useRef<RefreshJobs>({ token, jobs: new Map() });
  const [showConnect, setShowConnect] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [narrowHeader, setNarrowHeader] = useState(
    () => window.matchMedia(narrowHeaderQuery).matches,
  );
  const headerTools = useRef<HTMLDivElement>(null);
  const bookmark = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const media = window.matchMedia(narrowHeaderQuery);

    function syncHeader(matches: boolean) {
      setNarrowHeader(matches);
      if (!matches) setToolsOpen(false);
    }

    function onChange(event: MediaQueryListEvent) {
      syncHeader(event.matches);
    }

    media.addEventListener('change', onChange);
    syncHeader(media.matches);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!narrowHeader || !toolsOpen) return;

    function dismissOutside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !headerTools.current?.contains(event.target)
      ) {
        setToolsOpen(false);
      }
    }

    function dismissOnEscape(event: KeyboardEvent) {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        document.querySelector('dialog[open]')
      )
        return;
      event.preventDefault();
      setToolsOpen(false);
      bookmark.current?.focus();
    }

    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [narrowHeader, toolsOpen]);

  function openSettings(kind: 'repository' | 'token') {
    if (toolsOpen) {
      // Leave a visible trigger for the dialog to restore focus to.
      bookmark.current?.focus();
      setToolsOpen(false);
    }
    if (kind === 'repository') setShowAdd(true);
    else setShowConnect(true);
  }

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

  useRegionRefresh({
    token,
    worldRegions,
    refreshInterval,
    refresh,
    refreshJobs,
    setLoading,
    setProgress,
    setRefreshUsage,
    setSnapshots,
  });

  useEffect(() => {
    function refreshOnKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.shiftKey || event.altKey) return;

      const refreshKey = event.key === 'F5' && !event.ctrlKey && !event.metaKey;
      const refreshChord =
        event.key.toLowerCase() === 'r' && event.ctrlKey !== event.metaKey;
      if (!refreshKey && !refreshChord) return;

      // Holding a matched shortcut must not fall back to a browser reload.
      event.preventDefault();
      if (!event.repeat) refresh.current?.();
    }

    window.addEventListener('keydown', refreshOnKeyDown);
    return () => window.removeEventListener('keydown', refreshOnKeyDown);
  }, []);

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

  const select = useCallback((region: Region) => {
    setSelected(region);
    setSelectedQuest(undefined);
  }, []);

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

  const placementCache = useRef(
    new Map<
      string,
      {
        inventory: Report['branchInventory'];
        pulls: Report['branchPulls'];
        placement: RoadPlacement;
      }
    >(),
  );
  const roadPlacements = useMemo(() => {
    // Reuse a region's placement while its branch data is the same object, so
    // refreshing one repository does not re-measure the roads of the others.
    const cache = placementCache.current;
    const placements = new Map<string, RoadPlacement>();
    for (const [slug, { report }] of Object.entries(snapshots)) {
      if (!report) continue;
      const cached = cache.get(slug);
      const placement =
        cached &&
        cached.inventory === report.branchInventory &&
        cached.pulls === report.branchPulls
          ? cached.placement
          : placeBranchRoads(report.branchInventory, report.branchPulls);
      cache.set(slug, {
        inventory: report.branchInventory,
        pulls: report.branchPulls,
        placement,
      });
      placements.set(slug, placement);
    }
    for (const slug of [...cache.keys()])
      if (!placements.has(slug)) cache.delete(slug);
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

  const openPull = useCallback((region: Region, item: PullQuest) => {
    setSelectedQuest({ region, number: item.number, kind: 'pull' });
  }, []);

  const toolsLabel = toolsOpen ? '상단 도구 접기' : '상단 도구 열기';
  const refreshFill = !loading && (
    <span
      key={progress.key}
      className="refresh-fill"
      style={{ animationDuration: `${progress.duration}ms` }}
      aria-hidden="true"
    />
  );

  const refreshButton = (
    <button
      key="refresh"
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
      {refreshFill}
      <RefreshCw
        size={16}
        className={loading ? 'rotate' : ''}
        aria-hidden="true"
      />
    </button>
  );

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
          <div ref={headerTools} className="header-tools" data-open={toolsOpen}>
            <button
              ref={bookmark}
              type="button"
              className="header-bookmark"
              aria-label={toolsLabel}
              aria-expanded={toolsOpen}
              aria-controls="world-controls"
              title={toolsLabel}
              onClick={() => setToolsOpen(!toolsOpen)}
            >
              <span className="header-bookmark-face">
                {refreshFill}
                {toolsOpen ? (
                  <ChevronRight size={20} aria-hidden="true" />
                ) : (
                  <ChevronLeft size={20} aria-hidden="true" />
                )}
              </span>
            </button>
            <div
              id="world-controls"
              className="world-controls"
              inert={narrowHeader && !toolsOpen}
            >
              {narrowHeader && refreshButton}
              <ModeSwitch />
              <button
                className="connect add-repository-button"
                aria-label="저장소 추가"
                title="저장소 추가"
                onClick={() => openSettings('repository')}
              >
                <Plus size={19} aria-hidden="true" />
              </button>
              <button
                className="connect ticket-button"
                data-filled={Boolean(token)}
                data-tone={token ? tokenStatus.tone : undefined}
                aria-label={token ? tokenStatus.label : 'GitHub 연결'}
                title={token ? tokenStatus.label : 'GitHub 연결'}
                onClick={() => openSettings('token')}
              >
                <Ticket size={19} aria-hidden="true" />
              </button>
              {!narrowHeader && refreshButton}
              <div className="refresh-usage">
                <GitHubUsage
                  token={token}
                  refresh={
                    refreshUsage?.token === token
                      ? refreshUsage.usage
                      : undefined
                  }
                  refreshStale={
                    refreshUsage?.token === token && refreshUsage.stale
                  }
                />
              </div>
            </div>
          </div>
        </header>

        <section className="map-viewport" aria-label="저장소 왕국">
          <div className="kingdoms">
            {worldRegions.map((region) => {
              const focus = selectedQuest ?? inspected;
              return (
                <KingdomRegion
                  key={region.slug}
                  region={region}
                  snapshot={snapshots[region.slug]}
                  placement={roadPlacements.get(region.slug)}
                  localFocus={
                    focus?.region.slug === region.slug ? focus : undefined
                  }
                  token={token}
                  onHeritageLoad={updateSelectedHeritage}
                  openHeritage={setSelectedHeritage}
                  select={select}
                  openRoad={setSelectedRoad}
                  openPull={openPull}
                  openQuest={setSelectedQuest}
                  inspect={inspect}
                />
              );
            })}
          </div>
        </section>

        <footer className="world-footer">
          <ul
            className="expedition-legend"
            aria-label={isSimple ? '활동 범례' : '기본 파티 구성'}
          >
            <li className="actions">
              <PartyLeaderGlyph /> {isSimple ? 'GitHub' : '파티장'}
            </li>
            <li className="codex">
              <AdventurerGlyph agent="codex" /> Codex
            </li>
            <li className="claude">
              <AdventurerGlyph agent="claude" /> Claude
            </li>
          </ul>
        </footer>
      </main>
      {selected && (
        <RegionDetail
          key={selected.slug}
          region={selected}
          snapshot={snapshots[selected.slug]}
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
          title={
            roadPlacements.get(selectedRoad.region.slug)?.plazaRoad
              ? undefined
              : '작업 목록'
          }
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
            {selectedRoad.selection.roads.map((road, _, roads) => (
              <li key={road.name}>
                {roads.length > 1 && <strong>{road.name}</strong>}
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

createRoot(document.getElementById('root')!).render(
  <DisplayModeProvider>
    <App />
  </DisplayModeProvider>,
);
