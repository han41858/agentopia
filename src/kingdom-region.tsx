import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { PullQuest, Region } from '../server/model.ts';
import type { Heritage } from '../server/heritage.ts';
import { BranchRoadMap } from './branch-road-map.tsx';
import type { RoadPlacement, RoadSelection } from './branch-road-map.tsx';
import type { HeritageSelection } from './detail-dialogs.tsx';
import { isCurrentFacility } from './facility-kind.ts';
import { HeritageArc } from './heritage-arc.tsx';
import { KingdomWall } from './kingdom-wall.tsx';
import { FacilityMarker, KingdomMonsters, kingdomHue } from './map-markers.tsx';
import type { InspectionSource, MapEntry } from './map-markers.tsx';
import { objectSizes } from './object-sizes.ts';
import { requestHeritage } from './request.ts';
import { reportForges } from './snapshot.ts';
import type { Snapshot } from './snapshot.ts';
import { WorldArt } from './world-art.tsx';

export type RoadTarget = {
  region: Region;
  selection: RoadSelection | 'plaza';
};

// Memoized so that hovering or refreshing one kingdom leaves the others as-is.
export const KingdomRegion = memo(function KingdomRegion({
  region,
  snapshot,
  placement,
  localFocus,
  token,
  onHeritageLoad,
  openHeritage,
  select,
  openRoad,
  openPull,
  openQuest,
  inspect,
}: {
  region: Region;
  snapshot?: Snapshot;
  placement?: RoadPlacement;
  localFocus?: MapEntry;
  token: string;
  onHeritageLoad: (slug: string, data: Heritage) => void;
  openHeritage: (selection: HeritageSelection) => void;
  select: (region: Region) => void;
  openRoad: (target: RoadTarget) => void;
  openPull: (region: Region, pull: PullQuest) => void;
  openQuest: (entry: MapEntry) => void;
  inspect: (entry: MapEntry, active: boolean, source: InspectionSource) => void;
}) {
  const report = snapshot?.report;
  const forges = reportForges(report);
  const related = new Set(
    localFocus?.kind === 'pull'
      ? forges.find(({ number }) => number === localFocus.number)?.issues
      : [],
  );
  const visibleFacilities = forges
    .filter(isCurrentFacility)
    .sort(
      (left, right) =>
        (placement?.facilityOrder.get(left.number) ?? Infinity) -
          (placement?.facilityOrder.get(right.number) ?? Infinity) ||
        left.number - right.number,
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
          onLoad={onHeritageLoad}
          open={(metric, record) => openHeritage({ region, metric, record })}
        />
        <button
          className="kingdom"
          data-road-palace=""
          title={placement?.palace ? `왕궁 · ${placement.palace}` : undefined}
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
              localFocus?.kind !== 'pull' ? localFocus?.number : undefined
            }
            highlightedPull={
              localFocus?.kind === 'pull' ? localFocus.number : undefined
            }
            open={(selection) =>
              openRoad({
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
        {!placement?.plazaRoad && forges.length > 0 && (
          <button
            className="text-button work-list-button"
            onClick={() => openRoad({ region, selection: 'plaza' })}
          >
            작업 목록
          </button>
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
                    Boolean(item.issues?.includes(localFocus.number))
                  }
                  inspect={(active, source) =>
                    inspect(
                      { region, number: item.number, kind: 'pull' },
                      active,
                      source,
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
            localFocus?.kind === undefined ? localFocus?.number : undefined
          }
          related={related}
          inspect={(number, active, source) =>
            inspect({ region, number }, active, source)
          }
          openQuest={(item) => openQuest({ region, number: item.number })}
        />
      )}
    </section>
  );
});
