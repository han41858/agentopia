export function branchIssueNumber(name: string) {
  const match = /^ai\/issue-(\d+)-(codex|claude)$/.exec(name);
  return match ? Number(match[1]) : undefined;
}

export type BranchInventory = {
  defaultBranch: string;
  names: string[];
  partial: boolean;
};

export type BranchPull = {
  number: number;
  base: string;
  head: string;
  merged: boolean;
};

export type BranchRoad = {
  name: string;
  role: 'palace' | 'plaza' | 'road';
  parent?: string;
  pulls: BranchPull[];
};

export function branchCenters(
  inventory: BranchInventory,
  pulls: readonly BranchPull[],
) {
  const names = new Set([inventory.defaultBranch, ...inventory.names]);
  if (names.has('main') && names.has('dev'))
    return { palace: 'main', plaza: 'dev', bridge: true };
  const plaza =
    names.has('dev') &&
    inventory.defaultBranch !== 'dev' &&
    pulls.some((pull) => pull.base === 'dev' && names.has(pull.head))
      ? 'dev'
      : undefined;
  return { palace: inventory.defaultBranch, plaza, bridge: false };
}

export function buildBranchRoads(
  inventory: BranchInventory,
  pulls: readonly BranchPull[],
) {
  const names = new Set([inventory.defaultBranch, ...inventory.names]);
  if (inventory.partial) {
    for (const pull of pulls) {
      if (!pull.merged) {
        names.add(pull.head);
        names.add(pull.base);
      }
    }
  }
  const { palace, plaza } = branchCenters(inventory, pulls);
  const byHead = new Map<string, BranchPull[]>();
  for (const pull of pulls) {
    if (!names.has(pull.head)) continue;
    const previous = byHead.get(pull.head) ?? [];
    previous.push(pull);
    byHead.set(pull.head, previous);
  }
  const roads = [...names].map((name): BranchRoad => {
    const related = byHead.get(name) ?? [];
    const open = related.filter((pull) => !pull.merged);
    const targets = new Set(
      (open.length ? open : related).map(({ base }) => base),
    );
    const target =
      targets.size === 1 ? targets.values().next().value : undefined;
    return {
      name,
      role: name === palace ? 'palace' : name === plaza ? 'plaza' : 'road',
      parent:
        name !== palace && target && target !== name && names.has(target)
          ? target
          : undefined,
      pulls: related,
    };
  });
  const byName = new Map(roads.map((road) => [road.name, road]));
  const cyclic = new Set<string>();
  for (const road of roads) {
    const visited = new Map([[road.name, 0]]);
    let parent = road.parent;
    while (parent && !visited.has(parent)) {
      visited.set(parent, visited.size);
      parent = byName.get(parent)?.parent;
    }
    if (parent) {
      const start = visited.get(parent)!;
      for (const [name, index] of visited) if (index >= start) cyclic.add(name);
    }
  }
  for (const road of roads) if (cyclic.has(road.name)) delete road.parent;
  return roads.sort(
    (left, right) =>
      Number(right.role === 'palace') - Number(left.role === 'palace') ||
      Number(right.role === 'plaza') - Number(left.role === 'plaza') ||
      Number(right.pulls.some((pull) => !pull.merged)) -
        Number(left.pulls.some((pull) => !pull.merged)) ||
      left.name.localeCompare(right.name),
  );
}
