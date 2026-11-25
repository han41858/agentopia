import { objectSizes } from './object-sizes.ts';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useDisplayMode } from './display-mode.tsx';
import { WorldArt, spriteUrl } from './world-art.tsx';
import { measureRoadLayout } from './road-layout.ts';
import type { Layout, Path } from './road-layout.ts';
import { branchCenters, buildBranchRoads } from '../server/branch-roads.ts';
import type {
  BranchInventory,
  BranchPull,
  BranchRoad,
} from '../server/branch-roads.ts';

export type RoadSelection = {
  roads: BranchRoad[];
  partial: boolean;
};

export function placeBranchRoads(
  inventory: BranchInventory | undefined,
  pulls: BranchPull[] = [],
) {
  const roads = inventory ? buildBranchRoads(inventory, pulls) : [];
  const { palace, plaza, bridge } = inventory ? branchCenters(inventory) : {};
  const nonPalace = roads.filter((road) => road.role !== 'palace');
  const byName = new Map(nonPalace.map((road) => [road.name, road]));
  const chosen = new Map<string, BranchRoad>();
  for (const road of nonPalace) {
    if (chosen.size >= 6) break;
    chosen.set(road.name, road);
    let parent = road.parent;
    while (parent && !chosen.has(parent) && chosen.size < 6) {
      const target = byName.get(parent);
      if (!target) break;
      chosen.set(parent, target);
      parent = target.parent;
    }
  }
  const visible = [...chosen.values()];
  const palaceRoad = roads.find((road) => road.role === 'palace');
  const plazaRoad = visible.find((road) => road.role === 'plaza');
  const openPulls = new Map(
    roads.map((road) => [
      road.name,
      road.pulls
        .filter((pull) => !pull.merged)
        .sort((left, right) => left.number - right.number),
    ]),
  );
  const branches = nonPalace.filter((road) => road.role === 'road');
  branches.sort(
    (left, right) =>
      (openPulls.get(left.name)?.[0]?.number ?? Infinity) -
        (openPulls.get(right.name)?.[0]?.number ?? Infinity) ||
      left.name.localeCompare(right.name) ||
      Number(left.name > right.name) - Number(left.name < right.name),
  );
  const branchNames = new Set(branches.map((road) => road.name));
  const roots: BranchRoad[] = [];
  const childrenByParent = new Map<string, BranchRoad[]>();
  for (const road of branches) {
    if (!road.parent || !branchNames.has(road.parent)) {
      roots.push(road);
      continue;
    }
    const siblings = childrenByParent.get(road.parent) ?? [];
    siblings.push(road);
    childrenByParent.set(road.parent, siblings);
  }

  const facilityOrder = new Map<number, number>();
  function rank(road?: BranchRoad) {
    if (!road) return;
    for (const pull of openPulls.get(road.name) ?? []) {
      facilityOrder.set(pull.number, facilityOrder.size);
    }
  }
  rank(palaceRoad);
  rank(plazaRoad);

  // Keep each subtree together, even when its branch node is hidden by the cap.
  const rows: BranchRoad[][] = [];
  const lanes = new Map<string, number>();
  const visibleDepths = new Map<string, number>();
  const pending = roots.reverse();
  while (pending.length > 0) {
    const road = pending.pop()!;
    rank(road);
    if (chosen.has(road.name)) {
      const parentDepth = road.parent
        ? visibleDepths.get(road.parent)
        : undefined;
      const depth = (parentDepth ?? -1) + 1;
      visibleDepths.set(road.name, depth);
      (rows[depth] ??= []).push(road);
      lanes.set(road.name, lanes.size + 1);
    }
    const children = childrenByParent.get(road.name) ?? [];
    for (let index = children.length - 1; index >= 0; index--) {
      pending.push(children[index]);
    }
  }
  return {
    roads,
    palace,
    plaza,
    bridge,
    palaceRoad,
    plazaRoad,
    visible,
    rows,
    lanes,
    facilityOrder,
    showMore: Boolean(inventory?.partial) || visible.length < nonPalace.length,
    partial: Boolean(inventory?.partial),
  };
}

export type RoadPlacement = ReturnType<typeof placeBranchRoads>;

export function BranchRoadMap({
  placement,
  highlightedPull,
  highlightedIssue,
  open,
}: {
  placement: ReturnType<typeof placeBranchRoads>;
  highlightedPull?: number;
  highlightedIssue?: number;
  open: (selection: RoadSelection) => void;
}) {
  const {
    roads,
    palace,
    plaza,
    bridge,
    palaceRoad,
    plazaRoad,
    visible,
    rows,
    showMore,
    partial,
  } = placement;
  const row = useRef<HTMLDivElement>(null);
  const mask = useId();
  const mode = useDisplayMode();
  const [region, setRegion] = useState<HTMLElement | null>(null);
  const [layout, setLayout] = useState<Layout>();
  // Serialized copy of `layout`, kept so each measurement is compared once.
  const measured = useRef<string>(undefined);
  const [active, setActive] = useState<string>();

  useLayoutEffect(() => {
    const area = row.current?.closest<HTMLElement>('.kingdom-region');
    if (!area) return;
    setRegion(area);
    function measure() {
      if (!area) return;
      const next = measureRoadLayout(area, {
        palace,
        plaza,
        bridge,
        palaceRoad,
        visible,
        roads,
      });
      const text = JSON.stringify(next);
      if (text === measured.current) return;
      measured.current = text;
      setLayout(next);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    const courtyard = area.querySelector('.kingdom-area');
    if (courtyard) observer.observe(courtyard);
    const workshops = area.querySelector('.kingdom-workshops');
    if (workshops) observer.observe(workshops);
    const changes = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            record.type === 'attributes' ||
            record.target instanceof HTMLUListElement ||
            record.target === area,
        )
      )
        measure();
    });
    changes.observe(area, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-road-issues'],
    });
    return () => {
      observer.disconnect();
      changes.disconnect();
    };
  }, [palace, plaza, bridge, palaceRoad, visible, roads]);

  const focusedPulls = new Set<number>();
  if (highlightedPull !== undefined) focusedPulls.add(highlightedPull);
  const focusedBranches = new Set<string>();
  const parents = new Map(roads.map((road) => [road.name, road.parent]));
  function trace(name: string | undefined) {
    while (name && !focusedBranches.has(name)) {
      focusedBranches.add(name);
      name = parents.get(name);
    }
  }
  trace(active);
  if (highlightedIssue !== undefined) {
    for (const path of layout?.paths ?? []) {
      if (path.issue !== highlightedIssue) continue;
      trace(path.from);
      if (path.pull !== undefined) focusedPulls.add(path.pull);
    }
  }
  for (const road of visible) {
    if (road.pulls.some((pull) => focusedPulls.has(pull.number)))
      trace(road.name);
  }

  const inspectingEndpoint =
    highlightedIssue !== undefined || highlightedPull !== undefined;
  function isActive(path: Path) {
    if (path.issue !== undefined) {
      if (highlightedIssue !== undefined)
        return path.issue === highlightedIssue;
      if (highlightedPull !== undefined) return path.pull === highlightedPull;
    }
    return (
      active === path.from ||
      (path.pull === undefined
        ? focusedBranches.has(path.from)
        : focusedPulls.has(path.pull))
    );
  }
  const paths = (layout?.paths ?? [])
    .filter((path) => {
      if (path.issue !== undefined && active && !inspectingEndpoint)
        return path.from === active;
      return !path.secondary || isActive(path);
    })
    .map((path) => ({ path, selected: isActive(path) }));
  const dimOthers =
    inspectingEndpoint &&
    paths.some(
      ({ path, selected }) =>
        selected && path.pull !== undefined && path.issue !== undefined,
    );
  if (dimOthers) paths.sort((a, b) => Number(a.selected) - Number(b.selected));

  function roadButton(road: BranchRoad) {
    const lane = placement.lanes.get(road.name);
    return (
      <button
        key={road.name}
        type="button"
        className="branch-road-node"
        style={{ gridColumn: lane }}
        data-road-node={road.name}
        data-road-role={road.role}
        aria-label={
          road.role === 'plaza'
            ? `개발 광장 · ${road.name}`
            : `브랜치 ${road.name}`
        }
        title={road.name}
        data-active={
          highlightedPull !== undefined &&
          road.pulls.some((pull) => pull.number === highlightedPull)
        }
        onPointerEnter={() => setActive(road.name)}
        onPointerLeave={() => setActive(undefined)}
        onFocus={() => setActive(road.name)}
        onBlur={() => setActive(undefined)}
        onClick={() => open({ roads: [road], partial: false })}
      >
        {road.role === 'plaza' ? (
          <WorldArt sprite="plaza" size={objectSizes.plaza} />
        ) : (
          <span className="branch-junction" />
        )}
      </button>
    );
  }
  return (
    <div
      ref={row}
      className="branch-roads"
      role="group"
      aria-label="브랜치 도로망"
    >
      {layout &&
        region &&
        createPortal(
          <svg
            className="branch-road-lines"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <mask
                id={mask}
                maskUnits="userSpaceOnUse"
                x="0"
                y="0"
                width={layout.width}
                height={layout.height}
              >
                <rect
                  width={layout.width}
                  height={layout.height}
                  fill="white"
                />
                {layout.artwork.map(({ sprite, ...rect }, i) => (
                  <image
                    key={i}
                    href={spriteUrl(sprite, mode)}
                    {...rect}
                    style={{ filter: 'brightness(0)' }}
                  />
                ))}
                {layout.obstacles.map(({ x, y, width, height }, i) => (
                  <rect
                    key={i}
                    x={x - 1}
                    y={y - 1}
                    width={width + 2}
                    height={height + 2}
                    rx="3"
                    fill="black"
                  />
                ))}
              </mask>
            </defs>
            <g mask={`url(#${mask})`}>
              {paths.map(({ path, selected }) => (
                <path
                  key={path.key}
                  d={(selected && inspectingEndpoint && path.detour) || path.d}
                  strokeDasharray={path.guide ? '2 5' : undefined}
                  data-road-key={path.key}
                  data-merged={path.merged}
                  data-active={selected}
                  data-dimmed={dimOthers && !selected ? true : undefined}
                />
              ))}
            </g>
          </svg>,
          region,
        )}
      {plazaRoad && (
        <div className="branch-plaza">
          {bridge && (
            <WorldArt
              sprite="moatBridge"
              className="branch-bridge"
              size={objectSizes.moatBridge}
            />
          )}
          {roadButton(plazaRoad)}
        </div>
      )}
      {(rows.length > 0 || showMore) && (
        <div className="branch-road-tiers">
          {rows.map((roadsAtDepth, depth) => (
            <div
              className="branch-road-row"
              key={depth}
              style={{
                gridTemplateColumns: `repeat(${placement.lanes.size}, minmax(0,1fr))`,
              }}
            >
              {roadsAtDepth.map(roadButton)}
            </div>
          ))}
          {showMore && (
            <button
              type="button"
              className="branch-road-node branch-road-more"
              aria-label="브랜치 목록"
              title="브랜치 목록"
              onClick={() => open({ roads, partial })}
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
