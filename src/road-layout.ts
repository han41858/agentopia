import type { WorldSprite } from './world-art.tsx';
import { branchIssueNumber } from '../server/branch-roads.ts';
import type { BranchRoad } from '../server/branch-roads.ts';

type Point = { x: number; top: number; bottom: number };
export type Path = {
  key: string;
  from: string;
  pull?: number;
  issue?: number;
  secondary?: boolean;
  merged?: boolean;
  d: string;
};
export type Layout = {
  width: number;
  height: number;
  paths: Path[];
  roadTop: number;
  artwork: {
    sprite: WorldSprite;
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

// Reads marker positions inside one kingdom and returns the road geometry.
export function measureRoadLayout(
  area: HTMLElement,
  {
    palace,
    plaza,
    bridge,
    palaceRoad,
    visible,
    roads,
  }: {
    palace?: string;
    plaza?: string;
    bridge?: boolean;
    palaceRoad?: BranchRoad;
    visible: BranchRoad[];
    roads: BranchRoad[];
  },
): Layout {
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
  // below trims them to the painted edge of the plaza or facility.
  const middle = (element: Element): Point => {
    const rect = box(element);
    const y = rect.y + rect.height / 2;
    return { x: rect.x + rect.width / 2, top: y, bottom: y };
  };
  const plazaArt = area.querySelector('[data-road-role="plaza"] img');
  if (plaza && plazaArt) nodes.set(plaza, middle(plazaArt));
  const facilities = new Map(
    [...area.querySelectorAll<HTMLElement>('[data-road-pr]')].map((node) => {
      const marker = point(node);
      const art = node.querySelector('.facility-sprite');
      if (art) marker.top = middle(art).top;
      return [Number(node.dataset.roadPr), marker] as const;
    }),
  );
  const paths: Path[] = [];
  for (const road of palaceRoad ? [palaceRoad, ...visible] : visible) {
    const start = nodes.get(road.name);
    if (!start) continue;
    const parent = road.parent ? nodes.get(road.parent) : undefined;
    if (parent && !(bridge && road.name === plaza && road.parent === palace))
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
  for (const node of area.querySelectorAll<HTMLElement>('[data-road-issues]')) {
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
    if (paths.some((path) => path.from === road.name && path.issue === issue))
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
  return {
    width: bounds.width,
    height: bounds.height,
    paths,
    roadTop: bridge && plazaArt ? middle(plazaArt).top : 0,
    artwork: [
      ...area.querySelectorAll<HTMLImageElement>(
        '[data-road-role="plaza"] img, .facility-core img',
      ),
    ].map((img) => ({
      sprite: img.dataset.sprite as WorldSprite,
      ...box(img),
    })),
    obstacles: [
      ...area.querySelectorAll(
        '.heritage-slot, .kingdom, .branch-junction, .branch-road-more, .facility-marker .expedition-number, .facility-marker .adventurer-party, .facility-core > :not(img), .monster-marker',
      ),
    ].map(box),
  };
}
