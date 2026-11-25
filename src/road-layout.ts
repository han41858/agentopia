import type { WorldSprite } from './world-art.tsx';
import { branchIssueNumber } from '../server/branch-roads.ts';
import type { BranchRoad } from '../server/branch-roads.ts';

type Point = { x: number; top: number; bottom: number };
type Position = { x: number; y: number };
type Rect = Position & { width: number; height: number };
type Curve = [Position, Position, Position, Position];
export type Path = {
  key: string;
  from: string;
  pull?: number;
  issue?: number;
  secondary?: boolean;
  merged?: boolean;
  guide?: boolean;
  d: string;
  detour?: string;
};
export type Layout = {
  width: number;
  height: number;
  paths: Path[];
  artwork: {
    sprite: WorldSprite;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  obstacles: { x: number; y: number; width: number; height: number }[];
};

function roadCurve(start: Point, destination: Point): Curve {
  const level = Math.abs(start.top - destination.top) < 3;
  const descending = !level && start.bottom <= destination.top;
  const fromY = descending ? start.bottom : start.top;
  const toY = level || descending ? destination.top : destination.bottom;
  const middle = level
    ? Math.min(start.top, destination.top) - 13
    : (fromY + toY) / 2;
  return [
    { x: start.x, y: fromY },
    { x: start.x, y: middle },
    { x: destination.x, y: middle },
    { x: destination.x, y: toY },
  ];
}

const coordinates = ({ x, y }: Position) => `${x} ${y}`;

function curvePath([start, first, second, end]: Curve) {
  return `M${coordinates(start)} C${coordinates(first)} ${coordinates(second)} ${coordinates(end)}`;
}

function roadPath(start: Point, destination: Point) {
  return curvePath(roadCurve(start, destination));
}

const interpolate = (a: Position, b: Position, t: number): Position => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

const distance = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y);

const padded = ({ x, y, width, height }: Rect, padding: number): Rect => ({
  x: x - padding,
  y: y - padding,
  width: width + 2 * padding,
  height: height + 2 * padding,
});

// Subdivide only where the cubic's control bounds overlap the marker.
function curveHits(curve: Curve, rect: Rect, depth = 0): boolean {
  const xs = curve.map(({ x }) => x);
  const ys = curve.map(({ y }) => y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  if (
    right < rect.x ||
    left > rect.x + rect.width ||
    bottom < rect.y ||
    top > rect.y + rect.height
  )
    return false;
  if (depth === 12 || Math.max(right - left, bottom - top) < 0.5) return true;
  const [a, b, c, d] = curve;
  const ab = interpolate(a, b, 0.5);
  const bc = interpolate(b, c, 0.5);
  const cd = interpolate(c, d, 0.5);
  const leftHandle = interpolate(ab, bc, 0.5);
  const rightHandle = interpolate(bc, cd, 0.5);
  const middle = interpolate(leftHandle, rightHandle, 0.5);
  return (
    curveHits([a, ab, leftHandle, middle], rect, depth + 1) ||
    curveHits([middle, rightHandle, cd, d], rect, depth + 1)
  );
}

// A segment may follow a padded edge, but must not enter its interior.
function segmentHits(a: Position, b: Position, rect: Rect) {
  let enter = 0;
  let leave = 1;
  for (const axis of ['x', 'y'] as const) {
    const low = rect[axis];
    const high = low + (axis === 'x' ? rect.width : rect.height);
    const delta = b[axis] - a[axis];
    if (delta === 0) {
      if (a[axis] <= low || a[axis] >= high) return false;
    } else {
      const first = (low - a[axis]) / delta;
      const last = (high - a[axis]) / delta;
      enter = Math.max(enter, Math.min(first, last));
      leave = Math.min(leave, Math.max(first, last));
      if (enter >= leave) return false;
    }
  }
  return true;
}

function routeAround(
  start: Position,
  end: Position,
  obstacles: Rect[],
  bounds: Pick<Rect, 'width' | 'height'>,
  radius: number,
) {
  const corners = obstacles.flatMap(({ x, y, width, height }) => [
    { x, y },
    { x: x + width, y },
    { x, y: y + height },
    { x: x + width, y: y + height },
  ]);
  const points = [
    start,
    end,
    ...corners.filter(
      ({ x, y }) =>
        x >= 2 && y >= 2 && x <= bounds.width - 2 && y <= bounds.height - 2,
    ),
  ];
  // Find the shortest visible route through the padded corners.
  const costs = points.map(() => Infinity);
  const previous = points.map(() => -1);
  const settled = new Set<number>();
  costs[0] = 0;
  while (true) {
    let current = -1;
    let best = Infinity;
    for (const [index, cost] of costs.entries()) {
      if (cost < best && !settled.has(index)) {
        current = index;
        best = cost;
      }
    }
    if (current < 0) return;
    if (current === 1) break;
    settled.add(current);
    const a = points[current];
    for (const [index, b] of points.entries()) {
      if (settled.has(index)) continue;
      const cost = best + distance(a, b);
      if (cost >= costs[index] || obstacles.some((r) => segmentHits(a, b, r)))
        continue;
      costs[index] = cost;
      previous[index] = current;
    }
  }

  const route: Position[] = [];
  for (let index = 1; index >= 0; index = previous[index])
    route.push(points[index]);
  route.reverse();
  let d = `M${coordinates(start)}`;
  for (let index = 1; index < route.length - 1; index++) {
    const corner = route[index];
    const before = route[index - 1];
    const after = route[index + 1];
    const incoming = distance(corner, before);
    const outgoing = distance(corner, after);
    if (!incoming || !outgoing) continue;
    const trim = Math.min(radius, incoming / 2, outgoing / 2);
    const entry = interpolate(corner, before, trim / incoming);
    const exit = interpolate(corner, after, trim / outgoing);
    d += ` L${coordinates(entry)} Q${coordinates(corner)} ${coordinates(exit)}`;
  }
  return `${d} L${coordinates(end)}`;
}

function issueDetour(
  curve: Curve,
  markers: Rect[],
  bounds: Pick<Rect, 'width' | 'height'>,
) {
  // Leave room for the mask (1px), the active stroke and the rounded turns.
  if (!markers.some((marker) => curveHits(curve, padded(marker, 3)))) return;
  for (const radius of [5, 1]) {
    const route = routeAround(
      curve[0],
      curve[3],
      markers.map((marker) => padded(marker, 3 + radius)),
      bounds,
      radius,
    );
    if (route) return route;
  }
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
  const hub = plaza ?? palace;
  for (const road of palaceRoad ? [palaceRoad, ...visible] : visible) {
    const start = nodes.get(road.name);
    if (!start) continue;
    const parent = road.parent ? nodes.get(road.parent) : undefined;
    if (parent && !(bridge && road.name === plaza && road.parent === palace)) {
      paths.push({
        key: road.name,
        from: road.name,
        merged:
          road.pulls.length > 0 && road.pulls.every((pull) => pull.merged),
        d: roadPath(parent, start),
      });
    } else if (!parent && road.role === 'road' && hub) {
      // A map guide keeps the junction reachable without assigning a parent.
      const origin = nodes.get(hub);
      if (origin)
        paths.push({
          key: road.name,
          from: road.name,
          guide: true,
          d: roadPath(origin, start),
        });
    }
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
  const issueMarkers = [
    ...area.querySelectorAll<HTMLElement>('[data-road-issue]'),
  ].map((node) => ({
    issue: Number(node.dataset.roadIssue),
    rect: box(node),
  }));
  const issues = new Map(
    issueMarkers.map(({ issue, rect }) => [
      issue,
      {
        x: rect.x + rect.width / 2,
        top: rect.y,
        bottom: rect.y + rect.height,
      },
    ]),
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
      const curve = roadCurve(start, issues.get(issue)!);
      const markers = issueMarkers
        .filter((marker) => marker.issue !== issue)
        .map(({ rect }) => rect)
        .filter(({ width, height }) => width > 0 && height > 0);
      paths.push({
        key: `pr-${pull}-issue-${issue}`,
        from: pullBranches.get(pull) ?? '',
        pull,
        issue,
        secondary,
        d: curvePath(curve),
        detour: issueDetour(curve, markers, bounds),
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
    artwork: [
      ...area.querySelectorAll<HTMLImageElement>(
        '.branch-bridge, [data-road-role="plaza"] img, .facility-core img',
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
