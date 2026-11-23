import { onePerPageCount, verifiedCount } from './heritage.ts';
import type { Heritage, HeritageMetric } from './heritage.ts';
import type { Region } from './model.ts';
import { client, githubGraphql } from './github-client.ts';

export const heritageTtl = 30 * 60_000;

export async function repositoryHeritage(
  region: Region,
  token?: string,
): Promise<Heritage> {
  const data: Heritage = {};
  const get = client(region, token);
  const search = client(undefined, token, false, region.slug);
  function record(
    key: HeritageMetric,
    value: unknown,
    source: 'github' | 'search',
  ) {
    const count = verifiedCount(value);
    if (count !== undefined) data[key] = { count, source };
  }

  async function readIndexed(
    key: 'resolvedIssues' | 'mergedPulls',
    qualifiers: string,
  ) {
    const params = new URLSearchParams({
      q: `repo:${region.slug} ${qualifiers}`,
      per_page: '1',
    });
    const result = await search<{
      total_count: number;
      incomplete_results: boolean;
      items: { state?: string; state_reason?: string }[];
    }>(`/search/issues?${params}`, undefined, heritageTtl);
    if (
      result.incomplete_results !== false ||
      (key === 'resolvedIssues' &&
        result.total_count > 0 &&
        (result.items[0]?.state !== 'closed' ||
          result.items[0]?.state_reason !== 'completed'))
    )
      return;
    record(key, result.total_count, 'search');
  }

  async function readPullCounts() {
    if (!token) return readIndexed('mergedPulls', 'is:pr is:merged');

    const [owner, name] = region.slug.split('/');
    const result = await githubGraphql<{
      repository?: {
        mergedPulls: { totalCount: number };
        pulls: {
          totalCount: number;
          nodes: { reviews: { totalCount: number } }[];
        };
      };
    }>(
      `query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          mergedPulls: pullRequests(states: MERGED) { totalCount }
          pulls: pullRequests(first: 50) {
            totalCount
            nodes {
              reviews(states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) { totalCount }
            }
          }
        }
      }`,
      { owner, name },
      token,
      'heritage',
    );
    record('mergedPulls', result.repository?.mergedPulls?.totalCount, 'github');
    const pulls = result.repository?.pulls;
    if (!pulls || pulls.totalCount !== pulls.nodes.length) return;
    const counts = pulls.nodes.map((pull) =>
      verifiedCount(pull.reviews?.totalCount),
    );
    if (counts.every((count) => count !== undefined))
      record(
        'reviews',
        counts.reduce((sum, count) => sum + count, 0),
        'github',
      );
  }

  async function countComments(path: string) {
    let next = false;
    let link: string | null = null;
    const first = await get<unknown[]>(
      `${path}?per_page=1`,
      (more, header) => {
        next = more;
        link = header;
      },
      heritageTtl,
    );
    return onePerPageCount(first.length, next, link);
  }

  async function readComments() {
    const [discussion, inline] = await Promise.all([
      countComments('/issues/comments'),
      countComments('/pulls/comments'),
    ]);
    // GitHub truncates repository conversation pagination at 30,000 entries.
    if (discussion !== undefined && inline !== undefined && discussion < 30_000)
      record('comments', discussion + inline, 'github');
  }

  await Promise.allSettled([
    readIndexed('resolvedIssues', 'is:issue is:closed reason:completed'),
    readPullCounts(),
    readComments(),
  ]);
  return data;
}
