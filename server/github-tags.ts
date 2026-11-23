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
    return { tags, releaseCommits, partial: false, dateLookupFailed: false };
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
  // Start at observed tag commits: the default branch need not contain them.
  const pending = new Set(page.map((tag) => tag.commit.sha));
  const dates = new Map<string, string>();
  const get = client(region); // SHA-anchored pages remain valid across refreshes.
  let dateLookupFailed = false;
  for (let attempt = 0; attempt < 2 && pending.size; attempt++) {
    const anchor = pending.values().next().value!;
    pending.delete(anchor);
    try {
      const commits = await get<
        { sha: string; commit: { committer: { date: string } | null } }[]
      >(
        `/commits?sha=${encodeURIComponent(anchor)}&per_page=30`,
        undefined,
        2 * 60 * 60_000,
      );
      for (const { sha, commit } of commits) {
        if (commit.committer?.date) {
          dates.set(sha, commit.committer.date);
          pending.delete(sha);
        }
      }
    } catch {
      dateLookupFailed = true;
      break;
    }
  }
  const tags = page.map(({ name, commit }) => ({
    name,
    sha: commit.sha,
    committedAt: dates.get(commit.sha),
  }));
  return {
    tags,
    releaseCommits: new Map<string, string>(),
    partial,
    dateLookupFailed,
  };
}
