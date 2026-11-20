import type { HeritageMetric } from '../server/heritage.ts';

const thresholds: Record<HeritageMetric, readonly number[]> = {
  issues: [1, 25, 250, 2_500, 25_000],
  closedIssues: [1, 20, 200, 2_000, 20_000],
  pulls: [1, 30, 300, 3_000, 30_000],
  mergedPulls: [1, 20, 200, 2_000, 20_000],
  commits: [1, 100, 1_000, 10_000, 100_000],
  reviews: [1, 45, 450, 4_500, 45_000],
  comments: [1, 100, 1_000, 10_000, 100_000],
};

export function heritageTier(metric: HeritageMetric, count?: number) {
  return count === undefined
    ? 0
    : thresholds[metric].filter((threshold) => count >= threshold).length;
}
