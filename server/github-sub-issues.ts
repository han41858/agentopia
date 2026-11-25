import { client } from './github-client.ts';
import type { Issue, Region, SubIssue, SubIssueList } from './model.ts';

export function subIssueEntry(issue: Issue): SubIssue {
  return {
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    state: issue.state,
    stateReason: issue.state_reason,
  };
}

export async function readSubIssuePage(
  get: ReturnType<typeof client>,
  number: number,
  page = 1,
) {
  let hasNext = false;
  const children = await get<Issue[]>(
    `/issues/${number}/sub_issues?per_page=100${page === 1 ? '' : `&page=${page}`}`,
    (next) => {
      hasNext = next;
    },
    120_000,
  );
  return { children, hasNext };
}

export async function readSubIssues(
  region: Region,
  number: number,
  startPage: number,
  authorization?: string,
): Promise<SubIssueList> {
  const get = client(region, authorization);
  const items = new Map<string, SubIssue>();
  let page = startPage;
  // Bound work per popup request; an interrupted list retains its cursor.
  for (; page < startPage + 10; page++) {
    try {
      const { children, hasNext } = await readSubIssuePage(get, number, page);
      for (const child of children)
        items.set(child.html_url, subIssueEntry(child));
      if (!hasNext) return { items: [...items.values()] };
    } catch {
      break;
    }
  }
  return { items: [...items.values()], nextPage: page };
}
