import { objectSizes } from './object-sizes.ts';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { createPortal } from 'react-dom';
import { WorldArt } from './world-art.tsx';
import {
  branchCenters,
  branchIssueNumber,
  buildBranchRoads,
} from '../server/branch-roads.ts';
import type {
  BranchInventory,
  BranchPull,
  BranchRoad,
} from '../server/branch-roads.ts';

export type RoadSelection = {
  roads: BranchRoad[];
  partial: boolean;
};

type Point = { x: number; top: number; bottom: number };
type Path = {
  key: string;
  from: string;
  pull?: number;
  issue?: number;
  secondary?: boolean;
  merged?: boolean;
  d: string;
};
type Layout = {
  width: number;
  height: number;
  paths: Path[];
  artwork: {
    src: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  obstacles: { x: number; y: number; width: number; height: number }[];
};

function roadPath(start: Point, destination: Point) {
  if (Math.abs(start.top - destination.top) < 3) {
    const lane = Math.min(start.top, destination.top) - 5;
    return `M${start.x} ${start.top} C${start.x} ${lane - 8} ${destination.x} ${lane - 8} ${destination.x} ${destination.top}`;
  }
  const descending = start.bottom <= destination.top;
  const fromY = descending ? start.bottom : start.top;
  const toY = descending ? destination.top : destination.bottom;
  const middle = (fromY + toY) / 2;
  return `M${start.x} ${fromY} C${start.x} ${middle} ${destination.x} ${middle} ${destination.x} ${toY}`;
}

export function placeBranchRoads(
  inventory: BranchInventory | undefined,
  pulls: BranchPull[] = [],
) {
  const roads = inventory ? buildBranchRoads(inventory, pulls) : [];
  const { palace, plaza, bridge } = inventory
    ? branchCenters(inventory, pulls)
    : {};
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
  const branches = visible.filter((road) => road.role === 'road');
  const branchNames = new Set(branches.map((road) => road.name));
  const rows: BranchRoad[][] = [];
  const palaceRoad = roads.find((road) => road.role === 'palace');
  const plazaRoad = visible.find((road) => road.role === 'plaza');
  const facilityOrder = new Map<number, number>();
  function rank(road?: BranchRoad) {
    for (const pull of road?.pulls ?? []) {
      if (!pull.merged) facilityOrder.set(pull.number, facilityOrder.size);
    }
  }
  const lanes = new Map<string, number>();
  function visit(road: BranchRoad, depth: number) {
    (rows[depth] ??= []).push(road);
    lanes.set(road.name, lanes.size + 1);
    rank(road);
    for (const child of branches) {
      if (child.parent === road.name) visit(child, depth + 1);
    }
  }
  rank(palaceRoad);
  rank(plazaRoad);
  for (const root of branches) {
    if (!root.parent || !branchNames.has(root.parent)) visit(root, 0);
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
  const [region, setRegion] = useState<HTMLElement | null>(null);
  const [layout, setLayout] = useState<Layout>();
  const [active, setActive] = useState<string>();

  useLayoutEffect(() => {
    const area = row.current?.closest<HTMLElement>('.kingdom-region');
    if (!area) return;
    setRegion(area);
    function measure() {
      if (!area) return;
      const bounds = area.getBoundingClientRect();
      const box = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x - bounds.x,
          y: rect.y - bounds.y,
          width: rect.width,
          height: rect.height,
        };
      };
      const point = (element: Element): Point => {
        const rect = box(element);
        return {
          x: rect.x + rect.width / 2,
          top: rect.y,
          bottom: rect.y + rect.height,
        };
      };
      const nodes = new Map<string, Point>();
      const palaceNode = area.querySelector('[data-road-palace]');
      if (palace && palaceNode) nodes.set(palace, point(palaceNode));
      for (const node of area.querySelectorAll<HTMLElement>('[data-road-node]'))
        if (node.dataset.roadNode)
          nodes.set(
            node.dataset.roadNode,
            point(node.querySelector('.branch-junction') ?? node),
          );
      // Roads enter the transparent margins of the artwork; the SVG mask
      // below trims them to the painted edge of the bridge, plaza or facility.
      const middle = (element: Element): Point => {
        const rect = box(element);
        const y = rect.y + rect.height / 2;
        return { x: rect.x + rect.width / 2, top: y, bottom: y };
      };
      const plazaArt = area.querySelector('[data-road-role="plaza"] img');
      if (plaza && plazaArt) nodes.set(plaza, middle(plazaArt));
      const facilities = new Map(
        [...area.querySelectorAll<HTMLElement>('[data-road-pr]')].map(
          (node) => {
            const marker = point(node);
            const art = node.querySelector('.facility-sprite');
            if (art) marker.top = middle(art).top;
            return [Number(node.dataset.roadPr), marker] as const;
          },
        ),
      );
      const paths: Path[] = [];
      const crossing = area.querySelector('.branch-bridge');
      if (bridge && palaceNode && crossing && plaza && plazaArt) {
        paths.push(
          {
            key: 'approach-to-bridge',
            from: plaza,
            d: roadPath(point(palaceNode), middle(crossing)),
          },
          {
            key: 'approach-to-plaza',
            from: plaza,
            d: roadPath(middle(crossing), middle(plazaArt)),
          },
        );
      }
      for (const road of palaceRoad ? [palaceRoad, ...visible] : visible) {
        const start = nodes.get(road.name);
        if (!start) continue;
        const parent = road.parent ? nodes.get(road.parent) : undefined;
        if (
          parent &&
          !(bridge && road.name === plaza && road.parent === palace)
        )
          paths.push({
            key: road.name,
            from: road.name,
            merged:
              road.pulls.length > 0 && road.pulls.every((pull) => pull.merged),
            d: roadPath(parent, start),
          });
        for (const pull of road.pulls) {
          const endpoint = !pull.merged && facilities.get(pull.number);
          if (endpoint)
            paths.push({
              key: `pr-${pull.number}`,
              from: road.name,
              pull: pull.number,
              d: roadPath(start, endpoint),
            });
        }
      }
      const issues = new Map(
        [...area.querySelectorAll<HTMLElement>('[data-road-issue]')].map(
          (node) => [Number(node.dataset.roadIssue), point(node)] as const,
        ),
      );
      const pullBranches = new Map(
        roads.flatMap((road) =>
          road.pulls.map((pull) => [pull.number, road.name] as const),
        ),
      );
      // Keep the overview ordered on both banks. Additional many-to-many
      // connections appear when either endpoint is inspected.
      let lastIndex = -1;
      const issueRanks = new Map([...issues.keys()].map((id, i) => [id, i]));
      for (const node of area.querySelectorAll<HTMLElement>(
        '[data-road-issues]',
      )) {
        const pull = Number(node.dataset.roadPr);
        const start = facilities.get(pull);
        if (!start) continue;
        const targets = (node.dataset.roadIssues ?? '')
          .split(' ')
          .map(Number)
          .filter((id) => issues.has(id))
          .sort((a, b) => issueRanks.get(a)! - issueRanks.get(b)!);
        for (const issue of targets) {
          const index = issueRanks.get(issue)!;
          const secondary = index < lastIndex;
          if (!secondary) lastIndex = index;
          paths.push({
            key: `pr-${pull}-issue-${issue}`,
            from: pullBranches.get(pull) ?? '',
            pull,
            issue,
            secondary,
            d: roadPath(start, issues.get(issue)!),
          });
        }
      }
      for (const road of visible) {
        const issue = branchIssueNumber(road.name);
        if (issue === undefined || !issues.has(issue)) continue;
        if (
          paths.some((path) => path.from === road.name && path.issue === issue)
        )
          continue;
        const start = nodes.get(road.name);
        if (start)
          paths.push({
            key: `branch-${road.name}-issue-${issue}`,
            from: road.name,
            issue,
            d: roadPath(start, issues.get(issue)!),
          });
      }
      const next = {
        width: bounds.width,
        height: bounds.height,
        paths,
        artwork: [
          ...area.querySelectorAll<HTMLImageElement>(
            '.branch-bridge, [data-road-role="plaza"] img, .facility-core img',
          ),
        ].map((img) => ({
          src: img.currentSrc || img.src,
          ...box(img),
        })),
        obstacles: [
          ...area.querySelectorAll(
            '.heritage-slot, .kingdom, .branch-junction, .branch-road-more, .facility-marker .expedition-number, .facility-marker .adventurer-party, .facility-core > :not(img), .monster-marker',
          ),
        ].map(box),
      };
      setLayout((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
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
                {layout.artwork.map(({ src, ...rect }, i) => (
                  <image
                    key={i}
                    href={src}
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
              {layout.paths
                .filter((path) => {
                  if (path.issue === undefined) return true;
                  if (highlightedIssue !== undefined)
                    return path.issue === highlightedIssue;
                  if (highlightedPull !== undefined)
                    return path.pull === highlightedPull;
                  if (active) return path.from === active;
                  return !path.secondary;
                })
                .map((path) => (
                  <path
                    key={path.key}
                    d={path.d}
                    data-merged={path.merged}
                    data-active={
                      (highlightedIssue !== undefined &&
                        path.issue === highlightedIssue) ||
                      (path.pull === undefined &&
                        focusedBranches.has(path.from)) ||
                      active === path.from ||
                      (path.issue === undefined &&
                        path.pull !== undefined &&
                        focusedPulls.has(path.pull)) ||
                      (highlightedPull !== undefined &&
                        highlightedPull === path.pull)
                    }
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
