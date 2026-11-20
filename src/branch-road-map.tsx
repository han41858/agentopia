import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  GitBranch,
  GitFork,
  Landmark,
  MoreHorizontal,
  Signpost,
} from 'lucide-react';
import { buildBranchRoads } from '../server/branch-roads.ts';
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
  merged?: boolean;
  d: string;
};
type Layout = {
  width: number;
  height: number;
  paths: Path[];
  obstacles: { x: number; y: number; width: number; height: number }[];
};

function roadPath(start: Point, destination: Point) {
  if (Math.abs(start.top - destination.top) < 3) {
    const lane = Math.min(start.top, destination.top) - 5;
    return `M${start.x} ${start.top} V${lane} H${destination.x} V${destination.top}`;
  }
  const descending = start.bottom <= destination.top;
  const fromY = descending ? start.bottom : start.top;
  const toY = descending ? destination.top : destination.bottom;
  const elbow = (fromY + toY) / 2;
  return `M${start.x} ${fromY} V${elbow} H${destination.x} V${toY}`;
}

const emptyPulls: BranchPull[] = [];

export function BranchRoadMap({
  inventory,
  pulls = emptyPulls,
  highlightedPull,
  open,
}: {
  inventory: BranchInventory;
  pulls?: BranchPull[];
  highlightedPull?: number;
  open: (selection: RoadSelection) => void;
}) {
  const roads = useMemo(
    () => buildBranchRoads(inventory, pulls),
    [inventory, pulls],
  );
  const { visible, overflow } = useMemo(() => {
    const nonPalace = roads.filter((road) => road.role !== 'palace');
    const byName = new Map(nonPalace.map((road) => [road.name, road]));
    const visible = new Map<string, BranchRoad>();
    for (const road of nonPalace) {
      if (visible.size >= 6) break;
      visible.set(road.name, road);
      let parent = road.parent;
      while (parent && !visible.has(parent) && visible.size < 6) {
        const target = byName.get(parent);
        if (!target) break;
        visible.set(parent, target);
        parent = target.parent;
      }
    }
    return {
      visible: [...visible.values()],
      overflow: nonPalace.filter((road) => !visible.has(road.name)),
    };
  }, [roads]);
  const row = useRef<HTMLDivElement>(null);
  const mask = useId();
  const [layout, setLayout] = useState<Layout>();
  const [active, setActive] = useState<string>();

  useLayoutEffect(() => {
    const area = row.current?.parentElement;
    if (!area) return;
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
      const palace = area.querySelector('[data-road-palace]');
      if (palace) nodes.set(inventory.defaultBranch, point(palace));
      for (const node of area.querySelectorAll<HTMLElement>('[data-road-node]'))
        if (node.dataset.roadNode)
          nodes.set(node.dataset.roadNode, point(node));
      const facilities = new Map(
        [...area.querySelectorAll<HTMLElement>('[data-road-pr]')].map(
          (node) => [Number(node.dataset.roadPr), point(node)] as const,
        ),
      );
      const paths: Path[] = [];
      for (const road of visible) {
        const start = nodes.get(road.name);
        if (!start) continue;
        const parent = road.parent ? nodes.get(road.parent) : undefined;
        if (parent)
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
      const next = {
        width: bounds.width,
        height: bounds.height,
        paths,
        obstacles: [
          ...area.querySelectorAll(
            '.heritage-slot, .kingdom, .branch-road-node, .facility-marker',
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
    const workshops = area.querySelector('.kingdom-workshops');
    if (workshops) observer.observe(workshops);
    const changes = new MutationObserver((records) => {
      if (records.some((record) => record.target instanceof HTMLUListElement))
        measure();
    });
    changes.observe(area, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      changes.disconnect();
    };
  }, [inventory.defaultBranch, visible]);

  if (!visible.length && !inventory.partial) return null;
  return (
    <div
      ref={row}
      className="branch-roads"
      role="group"
      aria-label="브랜치 도로망"
    >
      {layout && (
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
              <rect width={layout.width} height={layout.height} fill="white" />
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
            {layout.paths.map((path) => (
              <path
                key={path.key}
                d={path.d}
                data-merged={path.merged}
                data-active={
                  active === path.from ||
                  (highlightedPull !== undefined &&
                    highlightedPull === path.pull)
                }
              />
            ))}
          </g>
        </svg>
      )}
      {visible.map((road) => {
        const Icon =
          road.role === 'plaza'
            ? Landmark
            : road.parent
              ? GitFork
              : road.pulls.some((pull) => !pull.merged)
                ? GitBranch
                : Signpost;
        return (
          <button
            key={road.name}
            type="button"
            className="branch-road-node"
            data-road-node={road.name}
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
            <Icon size={15} aria-hidden="true" />
          </button>
        );
      })}
      {(overflow.length > 0 || inventory.partial) && (
        <button
          type="button"
          className="branch-road-node"
          aria-label="브랜치 목록"
          title="브랜치 목록"
          onClick={() => open({ roads, partial: inventory.partial })}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
