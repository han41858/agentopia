import { client, githubGraphqlResult, GitHubError } from './github-client.ts';
import type { Region } from './model.ts';

type TagRecord = { name: string; sha?: string; committedAt?: string };
type Target = { oid?: string; committedDate?: string; target?: Target | null };

export type GitHubRelease = {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
};

type ReleaseNode = {
  tagName: string;
  url?: string | null;
  isDraft?: boolean | null;
  isPrerelease?: boolean | null;
  publishedAt?: string | null;
  tagCommit?: { oid: string } | null;
};

type TagNode = { name: string; target: Target | null };

export async function readAuthenticatedHistory(region: Region, token: string) {
  const [owner, name] = region.slug.split('/');
  const { data, errors } = await githubGraphqlResult<{
    repository: {
      refs: { nodes: (TagNode | null)[] | null } | null;
      releases: {
        nodes: (ReleaseNode | null)[] | null;
        pageInfo: { hasNextPage: boolean } | null;
      } | null;
    } | null;
  }>(
    `query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        refs(refPrefix: "refs/tags/", first: 30, orderBy: {field: TAG_COMMIT_DATE, direction: DESC}) {
          nodes { name target { ... on Commit { oid committedDate } ... on Tag { target { ... on Commit { oid committedDate } } } } }
        }
        releases(first: 30, orderBy: {field: CREATED_AT, direction: DESC}) {
          nodes { tagName url isDraft isPrerelease publishedAt tagCommit { oid } }
          pageInfo { hasNextPage }
        }
      }
    }`,
    { owner, name },
    token,
    'tags',
  );
  const refs = data?.repository?.refs?.nodes;
  const connection = data?.repository?.releases;
  const hasNextPage = connection?.pageInfo?.hasNextPage;
  const affected = (field: string) =>
    errors?.some(({ path }) => !path?.[1] || path[1] === field);
  const tagsFailed =
    !refs || refs.some((node) => node === null) || Boolean(affected('refs'));
  const tags: TagRecord[] = (refs ?? []).flatMap((node) => {
    if (!node) return [];
    const commit = node.target?.target ?? node.target;
    return [
      { name: node.name, sha: commit?.oid, committedAt: commit?.committedDate },
    ];
  });
  const releases: GitHubRelease[] = [];
  const releaseCommits = new Map<string, string>();
  let releasesFailed =
    !connection?.nodes ||
    typeof hasNextPage !== 'boolean' ||
    Boolean(affected('releases'));
  for (const node of connection?.nodes ?? []) {
    if (node?.tagName && node.tagCommit?.oid)
      releaseCommits.set(node.tagName, node.tagCommit.oid);
    if (
      !node?.tagName ||
      !node.url ||
      typeof node.isDraft !== 'boolean' ||
      typeof node.isPrerelease !== 'boolean' ||
      node.publishedAt === undefined
    ) {
      releasesFailed = true;
      continue;
    }
    releases.push({
      tag_name: node.tagName,
      html_url: node.url,
      draft: node.isDraft,
      prerelease: node.isPrerelease,
      published_at: node.publishedAt,
    });
  }
  return {
    tags,
    releases,
    releaseCommits,
    tagsFailed,
    releasesFailed,
    releasesTruncated: hasNextPage === true,
    partial: false,
    dateLookupFailed: false,
  };
}

export async function readTags(
  region: Region,
  force: boolean,
  latestPublishedTag: Promise<string | undefined>,
) {
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
  const releaseName = await latestPublishedTag;
  const releaseSha = page.find((tag) => tag.name === releaseName)?.commit.sha;
  const releaseRef =
    releaseName && !releaseSha ? `refs/tags/${releaseName}` : undefined;
  const firstAnchor = releaseSha ?? releaseRef;
  const dates = new Map<string, string>();
  const get = client(region); // SHA-anchored pages remain valid across refreshes.
  let dateLookupFailed = false;
  for (let attempt = 0; attempt < 2 && pending.size; attempt++) {
    const anchor =
      (attempt === 0 ? firstAnchor : undefined) ??
      pending.values().next().value!;
    pending.delete(anchor);
    try {
      const commits = await get<
        { sha: string; commit: { committer: { date: string } | null } }[]
      >(
        `/commits?sha=${encodeURIComponent(anchor)}&per_page=100`,
        undefined,
        anchor === releaseRef ? (force ? 0 : 120_000) : 2 * 60 * 60_000,
      );
      for (const { sha, commit } of commits) {
        if (commit.committer?.date) {
          dates.set(sha, commit.committer.date);
          pending.delete(sha);
        }
      }
    } catch (error) {
      if (
        anchor === releaseRef &&
        error instanceof GitHubError &&
        error.status === 404
      )
        continue;
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
