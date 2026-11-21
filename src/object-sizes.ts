// Desktop CSS pixels. The map scales as one unit on small screens.
export const objectSizes = {
  palace: 96,
  plaza: 64,
  moatBridge: 192,
  facility: 48,
  adventurer: 28,
  officer: 32,
  heritage: [40, 52, 64, 76, 88],
  monster: { min: 32, max: 56 },
  boss: { min: 64, max: 80 },
} as const;

export function monsterSize(boss: boolean, commits = 0) {
  const { min, max } = boss ? objectSizes.boss : objectSizes.monster;
  const growth = Math.min(17, Math.round(3 * Math.log2(1 + commits))) / 17;
  return min + Math.round((max - min) * growth);
}

export function heritageSize(tier: number) {
  return objectSizes.heritage[Math.max(1, tier) - 1];
}
