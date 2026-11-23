import { repositorySlug } from './model.ts';
import type { Region, Repository, RepositoryPage } from './model.ts';
import { GitHubError, client, githubGraphql } from './github-client.ts';

export type ListedRepository = {
  slug: string;
  private: boolean;
  visibility?: string;
};

export function ownerRepositories(owner: string, nodes: ListedRepository[]) {
  return nodes.flatMap((node) => {
    const slug = repositorySlug(node.slug);
    return slug?.startsWith(`${owner}/`)
      ? [
          {
            slug,
            private:
              node.private ||
              (node.visibility !== undefined &&
                node.visibility.toLowerCase() !== 'public'),
          },
        ]
      : [];
  });
}

export async function listRepositories(
  owner: string,
  cursor: string | null,
  token?: string,
): Promise<RepositoryPage> {
  if (token) {
    const data = await githubGraphql<{
      repositoryOwner: {
        repositories: {
          nodes: {
            nameWithOwner: string;
            isPrivate: boolean;
            visibility: string;
          }[];
          pageInfo: { hasNextPage: boolean; endCursor: string };
        };
      } | null;
    }>(
      `query($owner: String!, $cursor: String) {
        repositoryOwner(login: $owner) {
          repositories(first: 50, after: $cursor, isArchived: false, orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes { nameWithOwner isPrivate visibility }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { owner, cursor },
      token,
    );
    const result = data.repositoryOwner?.repositories;
    if (!result) throw new GitHubError(404);
    return {
      repositories: ownerRepositories(
        owner,
        result.nodes.map((node) => ({
          slug: node.nameWithOwner,
          private: node.isPrivate,
          visibility: node.visibility,
        })),
      ),
      next: result.pageInfo.hasNextPage ? result.pageInfo.endCursor : undefined,
    };
  }

  const page = Number(cursor ?? 1);
  const get = client();
  const results = await get<
    {
      full_name: string;
      private: boolean;
      visibility?: string;
      archived: boolean;
    }[]
  >(
    `/users/${owner}/repos?type=owner&sort=updated&direction=desc&per_page=50&page=${page}`,
  );
  return {
    repositories: ownerRepositories(
      owner,
      results
        .filter((item) => !item.archived)
        .map((item) => ({
          slug: item.full_name,
          private: item.private,
          visibility: item.visibility,
        })),
    ).filter((repo) => !repo.private),
    next: results.length === 50 ? String(page + 1) : undefined,
  };
}

export async function repositoryInfo(
  region: Region,
  token?: string,
): Promise<Repository> {
  const get = client(region, token);
  const metadata = await get<{
    full_name: string;
    private: boolean;
    visibility?: string;
    has_issues?: boolean;
  }>('');
  const slug = repositorySlug(metadata.full_name);
  if (!slug || typeof metadata.private !== 'boolean')
    throw new GitHubError(502);
  const restricted =
    metadata.private ||
    (metadata.visibility !== undefined && metadata.visibility !== 'public');
  if (restricted && !token) throw new GitHubError(404);
  if (restricted && metadata.has_issues !== false)
    await get('/issues?per_page=1');
  return { slug, private: restricted };
}
