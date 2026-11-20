export type ReviewOpinion = {
  state: 'APPROVED' | 'CHANGES_REQUESTED';
  at: string;
};

export type Discussion = {
  comments?: number;
  people: string[];
  complete: boolean;
};

export type PullActivity = Discussion & {
  shas: string[];
  commits?: number;
  reviews?: number;
  opinion?: ReviewOpinion;
};

export type ActivityProfile = {
  commits?: number;
  partialCommits?: boolean;
  issueComments?: number;
  pullComments?: number;
  reviews?: number;
  participants?: number;
  partialParticipants?: boolean;
  opinion?: ReviewOpinion;
};

export function latestOpinion(reviews: readonly ReviewOpinion[]) {
  return reviews.reduce<ReviewOpinion | undefined>(
    (latest, review) => (!latest || review.at > latest.at ? review : latest),
    undefined,
  );
}

export function summarizeActivity(
  issue: Discussion | undefined,
  pulls: readonly PullActivity[],
): ActivityProfile {
  const shas = new Set<string>();
  const people = new Set<string>();
  for (const record of issue ? [issue, ...pulls] : pulls)
    for (const login of record.people) people.add(login.toLowerCase());
  for (const pull of pulls)
    for (const sha of pull.shas) shas.add(sha.toLowerCase());

  function total(kind: 'comments' | 'reviews') {
    if (!pulls.length) return 0;
    let sum = 0;
    for (const pull of pulls) {
      const count = pull[kind];
      if (count === undefined) return undefined;
      sum += count;
    }
    return sum;
  }

  const partialCommits = pulls.some(
    (pull) => pull.commits === undefined || pull.commits > pull.shas.length,
  );
  const partialParticipants =
    issue?.complete === false || pulls.some((pull) => !pull.complete);
  return {
    commits:
      pulls.length === 1
        ? (pulls[0].commits ?? (shas.size || undefined))
        : partialCommits && !shas.size
          ? undefined
          : shas.size,
    partialCommits:
      partialCommits && !(pulls.length === 1 && pulls[0].commits !== undefined),
    issueComments: issue?.comments,
    pullComments: total('comments'),
    reviews: total('reviews'),
    participants: people.size || (partialParticipants ? undefined : 0),
    partialParticipants,
    opinion: latestOpinion(
      pulls.flatMap((pull) => (pull.opinion ? [pull.opinion] : [])),
    ),
  };
}

export function reviewOpinion(
  state?: string,
  at?: string | null,
): ReviewOpinion | undefined {
  if (at && (state === 'APPROVED' || state === 'CHANGES_REQUESTED'))
    return { state, at };
}
