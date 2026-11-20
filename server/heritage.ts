export const heritageKeys = [
  'issues',
  'closedIssues',
  'pulls',
  'mergedPulls',
  'commits',
  'reviews',
  'comments',
] as const;

export type HeritageMetric = (typeof heritageKeys)[number];
export type HeritageRecord = { count: number; source: 'github' | 'search' };
export type Heritage = Partial<Record<HeritageMetric, HeritageRecord>>;

export function verifiedCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

// With one entry per page, GitHub's final numbered page equals the collection size.
export function onePerPageCount(
  length: number,
  next: boolean,
  link: string | null,
) {
  if (!next) return length;
  const last = link?.match(/<([^>]+)>\s*;\s*rel="last"/)?.[1];
  if (!last) return undefined;
  try {
    const page = new URL(last).searchParams.get('page');
    return page && /^[1-9]\d*$/.test(page)
      ? verifiedCount(Number(page))
      : undefined;
  } catch {
    return undefined;
  }
}
