import { client, githubGraphql } from './github-client.ts';
import type { Region } from './model.ts';

type TagRecord = { name: string; sha?: string; committedAt?: string };
type Target = { oid: string; committedDate?: string; target?: Target };

export async function readTags(
  region: Region,
  token: string | undefined,
  force: boolean,
) {
  if (token) {
    const [owner, name] = region.slug.split('/');
    const { repository } = await githubGraphql<{
      repository: {
        refs: { nodes: { name: string; target: Target }[] };
        releases: {
          nodes: { tagName: string; tagCommit: { oid: string } | null }[];
        };
      };
    }>(
      `query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          refs(refPrefix: "refs/tags/", first: 30, orderBy: {field: TAG_COMMIT_DATE, direction: DESC}) {
            nodes { name target { ... on Commit { oid committedDate } ... on Tag { target { ... on Commit { oid committedDate } } } } }
          }
          releases(first: 30, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { tagName tagCommit { oid } } }
        }
      }`,
      { owner, name },
      token,
      'tags',
    );
    const tags: TagRecord[] = repository.refs.nodes.map(({ name, target }) => {
      const commit = target.target ?? target;
      return { name, sha: commit.oid, committedAt: commit.committedDate };
    });
    const releaseCommits = new Map(
      repository.releases.nodes.flatMap((release) =>
        release.tagCommit
          ? [[release.tagName, release.tagCommit.oid] as const]
          : [],
      ),
    );
    return { tags, releaseCommits, partial: false, missingDates: false };
  }

  let partial = false;
  const page = await client(region, undefined, force)<
    { name: string; commit: { sha: string } }[]
  >(
    '/tags?per_page=30',
    (next) => {
      partial = next;
    },
    120_000,
  );
  // One bounded page supplies dates for matching commits without a request per tag.
  const commits = page.length
    ? await client(region, undefined, force)<
        {
          sha: string;
          commit: { committer: { date: string } | null };
        }[]
      >('/commits?per_page=100', undefined, 120_000).catch(() => [])
    : [];
  const dates = new Map(
    commits.map((row) => [row.sha, row.commit.committer?.date]),
  );
  const tags = page.map(({ name, commit }) => ({
    name,
    sha: commit.sha,
    committedAt: dates.get(commit.sha),
  }));
  return {
    tags,
    releaseCommits: new Map<string, string>(),
    partial,
    missingDates: tags.some((tag) => !tag.committedAt),
  };
}
