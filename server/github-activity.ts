import { latestOpinion, reviewOpinion } from './activity.ts';
import type { Discussion, PullActivity } from './activity.ts';
import type {
  ActivityEntry,
  ActivityKind,
  ActivityPage,
  Region,
  Source,
} from './model.ts';
import { GitHubError, client } from './github-client.ts';
import type { Login } from './github-pull-links.ts';

export async function pullReviews(
  region: Region,
  pull: string,
  token?: string,
): Promise<Source[]> {
  const get = client(region, token);
  const reviews = await get<
    { user?: { login: string }; state: string; html_url: string }[]
  >(`/pulls/${pull}/reviews?per_page=100`);
  return reviews.map((review) => ({
    title: review.user?.login ?? 'GitHub review',
    status: review.state,
    url: review.html_url,
  }));
}

export async function activityPage(
  region: Region,
  kind: ActivityKind,
  number: string,
  page: number,
  token?: string,
): Promise<ActivityPage> {
  const get = client(region, token);
  const query = `?per_page=30&page=${page}`;
  let entries: ActivityEntry[];
  let hasNext = false;
  const pagination = (next: boolean) => {
    hasNext = next;
  };
  if (kind === 'commits') {
    const result = await get<
      {
        sha: string;
        html_url: string;
        author?: { login: string } | null;
        commit: { message: string; author?: { date?: string; name?: string } };
      }[]
    >(`/pulls/${number}/commits${query}`, pagination, 30_000);
    entries = result.map((item) => ({
      title: item.sha.slice(0, 7),
      url: item.html_url,
      author: item.author?.login ?? item.commit.author?.name,
      body: item.commit.message,
      at: item.commit.author?.date,
    }));
  } else {
    const resource =
      kind === 'comments'
        ? `/issues/${number}/comments`
        : `/pulls/${number}/reviews`;
    const result = await get<
      {
        user?: { login: string } | null;
        state?: string;
        html_url: string;
        body?: string | null;
        created_at?: string;
        submitted_at?: string;
      }[]
    >(resource + query, pagination, 30_000);
    entries = result
      .filter((item) => kind !== 'reviews' || item.state !== 'PENDING')
      .map((item) => ({
        title: item.user?.login ?? 'GitHub',
        url: item.html_url,
        status: item.state,
        body: item.body?.replace(/<!--[\s\S]*?-->/g, '').trim() || undefined,
        at: item.submitted_at ?? item.created_at,
      }));
  }
  return { entries, next: hasNext ? page + 1 : undefined };
}

export async function activitySummary(
  region: Region,
  scope: 'issue' | 'pull',
  number: string,
  token?: string,
) {
  const get = client(region, token);
  async function collect<T>(path: string, maxPages: number) {
    const entries: T[] = [];
    let hasNext = true;
    for (let page = 1; hasNext && page <= maxPages; page++) {
      const batch = await get<T[]>(
        `${path}?per_page=100&page=${page}`,
        (next) => {
          hasNext = next;
        },
        30_000,
      );
      entries.push(...batch);
    }
    return { entries, complete: !hasNext };
  }

  const comments = collect<{ user?: Login | null }>(
    `/issues/${number}/comments`,
    5,
  );
  if (scope === 'issue') {
    const [issue, discussion] = await Promise.all([
      get<{ user?: Login | null; comments: number; pull_request?: unknown }>(
        `/issues/${number}`,
        undefined,
        30_000,
      ),
      comments,
    ]);
    if (issue.pull_request) throw new GitHubError(404);
    return {
      comments: issue.comments,
      people: [
        issue.user,
        ...discussion.entries.map(({ user }) => user),
      ].flatMap((user) => (user ? [user.login] : [])),
      complete:
        discussion.complete && discussion.entries.length === issue.comments,
    } satisfies Discussion;
  }

  const [pull, discussion, commits, reviews] = await Promise.all([
    get<{ user?: Login | null; comments: number; commits: number }>(
      `/pulls/${number}`,
      undefined,
      30_000,
    ),
    comments,
    collect<{ sha: string }>(`/pulls/${number}/commits`, 3),
    collect<{ user?: Login | null; state: string; submitted_at?: string }>(
      `/pulls/${number}/reviews`,
      5,
    ),
  ]);
  const published = reviews.entries.filter(({ state }) => state !== 'PENDING');
  const effective = new Map<string, (typeof published)[number]>();
  for (const review of published) {
    const login = review.user?.login.toLowerCase();
    if (
      !login ||
      !review.submitted_at ||
      !['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)
    )
      continue;
    if (review.submitted_at >= (effective.get(login)?.submitted_at ?? ''))
      effective.set(login, review);
  }
  return {
    shas: commits.entries.map(({ sha }) => sha),
    commits: pull.commits,
    comments: pull.comments,
    reviews: reviews.complete ? published.length : undefined,
    people: [
      pull.user,
      ...discussion.entries.map(({ user }) => user),
      ...published.map(({ user }) => user),
    ].flatMap((user) => (user ? [user.login] : [])),
    complete:
      discussion.complete &&
      discussion.entries.length === pull.comments &&
      reviews.complete,
    opinion: reviews.complete
      ? latestOpinion(
          [...effective.values()].flatMap(({ state, submitted_at }) => {
            const opinion = reviewOpinion(state, submitted_at);
            return opinion ? [opinion] : [];
          }),
        )
      : undefined,
  } satisfies PullActivity;
}
