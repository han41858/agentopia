import { useEffect, useState } from 'react';
import type { SubIssue, SubIssueList } from '../server/model.ts';
import { request } from './request.ts';
import './sub-issues.css';

function issueStatus(issue: SubIssue) {
  if (issue.state === 'open') return { glyph: '○', label: '열림' };
  if (issue.state === 'closed') {
    if (issue.stateReason === 'completed') return { glyph: '✓', label: '완료' };
    if (issue.stateReason === 'not_planned')
      return { glyph: '⊘', label: '계획 없음' };
    if (issue.stateReason === 'duplicate') return { glyph: '≡', label: '중복' };
    return { glyph: '?', label: '닫힘 · 종료 사유 미확인' };
  }
  return { glyph: '?', label: '상태 미확인' };
}

export function SubIssueSection({
  region,
  number,
  token,
  initial,
}: {
  region: string;
  number: number;
  token: string;
  initial: SubIssueList;
}) {
  const { nextPage } = initial;
  const [loaded, setLoaded] = useState<{
    token: string;
    startPage: number;
    list: SubIssueList;
  }>();
  useEffect(() => {
    if (nextPage === undefined) return;
    const controller = new AbortController();
    const save = (list: SubIssueList) => {
      if (!controller.signal.aborted)
        setLoaded({ token, startPage: nextPage, list });
    };
    void request<SubIssueList>(
      new URLSearchParams({
        repo: region,
        subIssues: String(number),
        page: String(nextPage),
      }),
      token,
      controller.signal,
    ).then(save, () => save({ items: [], nextPage }));
    return () => controller.abort();
  }, [region, number, token, nextPage]);

  const result =
    loaded?.token === token && loaded?.startPage === nextPage
      ? loaded.list
      : undefined;
  const pending = nextPage !== undefined && !result;
  const complete = nextPage === undefined || (result && !result.nextPage);
  // A complete lookup from page 1 supersedes an older report snapshot.
  const seed = nextPage === 1 && complete ? [] : initial.items;
  const items = new Map(seed.map((issue) => [issue.url, issue]));
  for (const issue of result?.items ?? []) items.set(issue.url, issue);
  if (complete && items.size === 0) return null;

  const completed = [...items.values()].filter(
    (issue) => issue.state === 'closed' && issue.stateReason === 'completed',
  ).length;
  return (
    <section className="sub-issues" aria-label="서브 이슈">
      <h4>
        {complete ? `서브 이슈 · ${completed}/${items.size} 완료` : '서브 이슈'}
      </h4>
      {items.size > 0 && (
        <ul>
          {[...items.values()].map((issue) => {
            const { glyph, label } = issueStatus(issue);
            return (
              <li key={issue.url}>
                <a href={issue.url} target="_blank" rel="noreferrer">
                  <span role="img" aria-label={label} title={label}>
                    {glyph}
                  </span>
                  <span>
                    #{issue.number} · {issue.title}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {!complete && (
        <p role="status">
          {pending
            ? '서브 이슈 목록 확인 중…'
            : '서브 이슈를 일부만 확인했습니다.'}
        </p>
      )}
    </section>
  );
}
