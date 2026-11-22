import { latestOpinion, reviewOpinion } from './activity.ts';
import type { PullActivity } from './activity.ts';
import { linkedPullIssues, pullActor } from './model.ts';
import type { Pull, PullLinks, Region } from './model.ts';
import { GitHubError, githubGraphql } from './github-client.ts';

export type Login = { login: string; __typename?: string };

export type NativeDiscussion = {
  totalCount?: number;
  nodes?: { author: Login | null }[];
};

export type NativeReview = {
  author: Login | null;
  state: string;
  submittedAt: string | null;
};

export type NativePull = {
  number: number;
  author?: Login | null;
  commits?: { totalCount?: number; nodes?: { commit: { oid: string } }[] };
  comments?: NativeDiscussion;
  reviews?: NativeDiscussion;
  latestOpinionatedReviews?: { nodes: NativeReview[] };
  closingIssuesReferences: {
    nodes: { number: number; repository: { nameWithOwner: string } }[];
  };
  latestReviews: {
    nodes: {
      author: { login: string; __typename: string } | null;
      state: string;
      submittedAt: string | null;
      commit: { oid: string } | null;
    }[];
  };
};

export async function nativePullLinks(
  region: Region,
  token: string,
  pulls: Pull[],
) {
  const [owner, name] = region.slug.split('/');
  const candidates = pulls
    .filter(
      ({ number, state, merged_at }) =>
        Number.isSafeInteger(number) &&
        number > 0 &&
        (state === 'open' || merged_at),
    )
    .sort((left, right) => {
      const priority = (pull: Pull) =>
        Number(pull.state === 'open') * 2 +
        Number(linkedPullIssues(pull, region).length > 0);
      return priority(right) - priority(left);
    })
    .slice(0, 12);
  const samples = candidates
    .map(
      ({ number }) =>
        `sample${number}: pullRequest(number: ${number}) { ...ActivitySample }`,
    )
    .join(' ');
  const query = `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        pullRequests(first: 50, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes { ...PullActivity }
        }
        merged: pullRequests(first: 50, states: MERGED, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes { ...PullActivity }
        }
        ${samples}
        issues(first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes {
            number
            timelineItems(last: 1, itemTypes: [REOPENED_EVENT, CLOSED_EVENT]) { nodes { __typename } }
          }
        }
      }
    }
    fragment PullActivity on PullRequest {
      number
      author { login }
      commits { totalCount }
      comments { totalCount }
      reviews(states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) { totalCount }
      latestOpinionatedReviews(last: 10) { nodes { state submittedAt } }
      closingIssuesReferences(first: 20) { nodes { number repository { nameWithOwner } } }
      latestReviews(first: 10) { nodes { author { login __typename } state submittedAt commit { oid } } }
    }
    ${
      samples
        ? `fragment ActivitySample on PullRequest {
      commits(first: 35) { nodes { commit { oid } } }
      comments(last: 25) { nodes { author { login } } }
      reviews(last: 25, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) { nodes { author { login __typename } } }
    }`
        : ''
    }`;
  const data = await githubGraphql<{
    repository?: Partial<
      Record<
        `sample${number}`,
        Partial<Pick<NativePull, 'commits' | 'comments' | 'reviews'>>
      >
    > & {
      pullRequests: { nodes: NativePull[] };
      merged?: { nodes: NativePull[] };
      issues?: {
        nodes: {
          number: number;
          timelineItems: { nodes: { __typename: string }[] };
        }[];
      };
    };
  }>(query, { owner, name }, token);
  if (!data.repository) throw new GitHubError(404);
  const nodes = [
    ...data.repository.pullRequests.nodes,
    ...(data.repository.merged?.nodes ?? []),
  ];

  const headByNumber = new Map(
    pulls.map((pull) => [pull.number, pull.head.sha]),
  );
  const links = new Map<number, PullLinks>();
  for (const pull of nodes) {
    if (!headByNumber.has(pull.number)) continue;
    const issues = pull.closingIssuesReferences.nodes
      .filter(
        (issue) => issue.repository.nameWithOwner.toLowerCase() === region.slug,
      )
      .map(({ number }) => number);
    const latest = pull.latestReviews.nodes
      .filter(
        (review) =>
          review.submittedAt &&
          review.state !== 'DISMISSED' &&
          review.commit?.oid === headByNumber.get(pull.number),
      )
      .sort((a, b) =>
        (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''),
      )[0];
    const reviewer = pullActor(
      latest?.author?.login,
      latest?.author?.__typename,
    );
    const sample = data.repository[`sample${pull.number}`];
    const commenters = sample?.comments?.nodes ?? [];
    const reviewers = sample?.reviews?.nodes ?? [];
    const opinions = pull.latestOpinionatedReviews?.nodes ?? [];
    const activity: PullActivity = {
      shas: sample?.commits?.nodes?.map(({ commit }) => commit.oid) ?? [],
      commits: pull.commits?.totalCount,
      comments: pull.comments?.totalCount,
      reviews: pull.reviews?.totalCount,
      people: [
        pull.author?.login,
        ...[...commenters, ...reviewers].map(({ author }) => author?.login),
      ].filter((login): login is string => Boolean(login)),
      complete:
        pull.comments?.totalCount === commenters.length &&
        pull.reviews?.totalCount === reviewers.length,
      opinion: latestOpinion(
        opinions.flatMap(({ state, submittedAt }) => {
          const opinion = reviewOpinion(state, submittedAt);
          return opinion ? [opinion] : [];
        }),
      ),
    };
    links.set(pull.number, {
      issues,
      activity,
      activities: {
        commits: pull.commits?.totalCount,
        comments: pull.comments?.totalCount,
        reviews: pull.reviews?.totalCount,
      },
      reviewer,
      review: reviewer ? latest.state : undefined,
      reviewParticipants: [
        ...new Set(
          [
            ...reviewers,
            ...pull.latestReviews.nodes.filter((entry) => entry.submittedAt),
          ].flatMap(({ author }) => {
            const agent = pullActor(author?.login, author?.__typename);
            return agent ? [agent] : [];
          }),
        ),
      ],
    });
  }
  const reopened = new Set(
    (data.repository.issues?.nodes ?? [])
      .filter(
        ({ timelineItems }) =>
          timelineItems.nodes[0]?.__typename === 'ReopenedEvent',
      )
      .map(({ number }) => number),
  );
  return { links, reopened };
}
