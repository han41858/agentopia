import { useEffect, useState } from 'react';
import {
  ClipboardCheck,
  GitCommitHorizontal,
  MessageCircle,
  MessagesSquare,
} from 'lucide-react';
import type {
  ActivityCounts,
  ActivityKind,
  ActivityPage,
  Quest,
} from '../server/model.ts';
import { summarizeActivity } from '../server/activity.ts';
import type {
  ActivityProfile,
  Discussion,
  PullActivity,
} from '../server/activity.ts';
import { request } from './request.ts';
import { OutLink, ResultLink } from './dialog.tsx';

export const activityKinds = ['commits', 'comments', 'reviews'] as const;

export const activityDisplay = {
  commits: { Icon: GitCommitHorizontal, label: '커밋' },
  comments: { Icon: MessageCircle, label: '댓글' },
  reviews: { Icon: ClipboardCheck, label: '리뷰' },
};

export type BrowserProps = {
  region: string;
  number: number;
  token: string;
  kinds?: readonly ActivityKind[];
  counts?: ActivityCounts;
};

export function useActivityBrowser(
  { region, number, token, kinds = activityKinds, counts }: BrowserProps,
  partialCommits = false,
) {
  const [selected, setSelected] = useState<ActivityKind>();
  const [visited, setVisited] = useState<ActivityKind[]>([]);
  const counters = (
    <div className="activity-counters">
      {kinds.map((kind) => {
        const { Icon, label } = activityDisplay[kind];
        const count = counts?.[kind];
        const value =
          count === undefined
            ? '—'
            : `${count}${kind === 'commits' && partialCommits ? '+' : ''}`;
        return (
          <button
            key={kind}
            type="button"
            className="text-button activity-counter"
            title={label}
            aria-label={
              count === undefined
                ? label
                : `${label} ${count}개${kind === 'commits' && partialCommits ? ' 이상' : ''}`
            }
            aria-expanded={selected === kind}
            onClick={() => {
              if (!visited.includes(kind)) setVisited([...visited, kind]);
              setSelected(selected === kind ? undefined : kind);
            }}
          >
            <Icon size={16} aria-hidden="true" />
            {value}
          </button>
        );
      })}
    </div>
  );
  const entries = visited.map((kind) => (
    <div key={kind} hidden={selected !== kind}>
      <ActivityEntries
        region={region}
        number={number}
        kind={kind}
        token={token}
      />
    </div>
  ));
  return { counters, entries };
}

export function ActivityBrowser(props: BrowserProps) {
  const { counters, entries } = useActivityBrowser(props);
  return (
    <div className="activity-browser">
      {counters}
      {entries}
    </div>
  );
}

export function ActivityEntries({
  region,
  number,
  kind,
  token,
  linkedEvidenceUrl,
  compact = false,
}: {
  region: string;
  number: number;
  kind: ActivityKind;
  token: string;
  linkedEvidenceUrl?: string;
  compact?: boolean;
}) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ActivityPage>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    request<ActivityPage>(
      new URLSearchParams({
        repo: region,
        activity: kind,
        number: String(number),
        page: String(page),
      }),
      token,
      controller.signal,
    ).then(
      (data) => {
        if (!controller.signal.aborted) {
          setResult((previous) => ({
            entries:
              page === 1
                ? data.entries
                : [...(previous?.entries ?? []), ...data.entries],
            next: data.next,
          }));
        }
      },
      (cause: Error) => {
        if (!controller.signal.aborted) setError(cause.message);
      },
    );
    return () => controller.abort();
  }, [region, number, kind, page, token]);
  if (error) return <p className="fetch-error">{error}</p>;
  if (!result) return <p role="status">GitHub 기록 조회 중…</p>;
  return (
    <div className="activity-entries">
      {!result.entries.length && <p>GitHub 기록이 없습니다.</p>}
      {result.entries.map((item) =>
        compact ? (
          <ResultLink key={item.url} item={item} />
        ) : (
          <div className="activity-entry" key={item.url}>
            {item.url === linkedEvidenceUrl ? (
              <strong>위에 표시된 근거 댓글</strong>
            ) : (
              <OutLink item={item} />
            )}
            {(item.author || item.at) && (
              <small>
                {[
                  item.author,
                  item.at && new Date(item.at).toLocaleString('ko-KR'),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            )}
            {item.body && <p>{item.body}</p>}
          </div>
        ),
      )}
      {result.next && (
        <button
          type="button"
          className="text-button"
          disabled={page === result.next}
          onClick={() => setPage(result.next ?? page)}
        >
          더 보기
        </button>
      )}
    </div>
  );
}

export type IssueActivityKind = ActivityKind | 'issueComments';

export function IssuePullEntries({
  region,
  token,
  pulls,
  kind,
}: {
  region: string;
  token: string;
  pulls: Quest['pulls'];
  kind: ActivityKind;
}) {
  return pulls
    .filter((pull) => pull.activities?.[kind] !== 0)
    .map((pull) => (
      <PullEntrySource
        key={pull.number}
        region={region}
        token={token}
        number={pull.number}
        kind={kind}
        chooseSource={pulls.length > 1}
      />
    ));
}

function PullEntrySource({
  region,
  token,
  number,
  kind,
  chooseSource,
}: {
  region: string;
  token: string;
  number: number;
  kind: ActivityKind;
  chooseSource: boolean;
}) {
  const [visited, setVisited] = useState(false);
  const entries = (
    <ActivityEntries
      region={region}
      token={token}
      number={number}
      kind={kind}
      compact={kind === 'commits'}
    />
  );
  if (!chooseSource) return entries;
  return (
    <details
      className="issue-history"
      onToggle={(event) => {
        if (event.currentTarget.open) setVisited(true);
      }}
    >
      <summary>
        PR #{number} · {activityDisplay[kind].label}
      </summary>
      {visited && entries}
    </details>
  );
}

export type ActivitySummaryProps = {
  region: string;
  token: string;
  issue?: number;
  pulls: string;
  initial?: ActivityProfile;
};

export function useActivitySummary({
  region,
  token,
  issue,
  pulls,
  initial,
}: ActivitySummaryProps) {
  const [loaded, setLoaded] = useState<ActivityProfile>();
  const [failed, setFailed] = useState(false);
  const needsDetails =
    !initial ||
    initial.partialCommits ||
    initial.commits === undefined ||
    initial.pullComments === undefined ||
    initial.reviews === undefined ||
    (issue !== undefined && initial.issueComments === undefined);
  useEffect(() => {
    if (!needsDetails) return;
    const controller = new AbortController();
    const get = <T,>(summary: string, number: string) =>
      request<T>(
        new URLSearchParams({ repo: region, summary, number }),
        token,
        controller.signal,
      );
    async function load() {
      const issueRecord =
        issue === undefined
          ? undefined
          : await get<Discussion>('issue', String(issue));
      const numbers = pulls ? pulls.split(',') : [];
      const records: PullActivity[] = [];
      for (let offset = 0; offset < numbers.length; offset += 3) {
        records.push(
          ...(await Promise.all(
            numbers
              .slice(offset, offset + 3)
              .map((number) => get<PullActivity>('pull', number)),
          )),
        );
      }
      if (!controller.signal.aborted)
        setLoaded(summarizeActivity(issueRecord, records));
    }
    void load().catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [region, token, issue, pulls, needsDetails]);
  const status =
    needsDetails && !loaded
      ? failed
        ? '일부 활동을 조회하지 못했습니다.'
        : 'GitHub 활동 집계 확인 중…'
      : undefined;
  return { activity: loaded ?? initial, status };
}

export function IssueActivityCounters(
  props: ActivitySummaryProps & {
    fallbackComments?: number;
    selected?: IssueActivityKind;
    toggle: (kind: IssueActivityKind) => void;
  },
) {
  const { activity, status } = useActivitySummary(props);
  const counters = [
    [
      'commits',
      activityDisplay.commits.Icon,
      '고유 커밋',
      activity?.commits,
      activity?.partialCommits,
    ],
    [
      'issueComments',
      activityDisplay.comments.Icon,
      '이슈 댓글',
      activity?.issueComments ?? props.fallbackComments,
    ],
    ['comments', MessagesSquare, 'PR 댓글', activity?.pullComments],
    ['reviews', activityDisplay.reviews.Icon, '리뷰', activity?.reviews],
  ] as const;
  return (
    <div className="activity-counters" role="group" aria-label="이슈 활동">
      {counters.map(([kind, Icon, label, count, partial]) => {
        const name =
          count === undefined
            ? label + ' 미확인'
            : `${label} ${count}개${partial ? ' 이상' : ''}`;
        const content = (
          <>
            <Icon size={16} aria-hidden="true" />
            {count === undefined
              ? '—'
              : count.toLocaleString('ko-KR') + (partial ? '+' : '')}
          </>
        );
        const title =
          count === undefined && status ? name + ' · ' + status : name;
        const expanded = props.selected === kind;
        const canExpand =
          expanded ||
          (kind === 'issueComments'
            ? count !== 0
            : Boolean(props.pulls) && (count !== 0 || partial));
        return canExpand ? (
          <button
            type="button"
            className="text-button activity-counter"
            key={kind}
            aria-label={name}
            title={title}
            aria-expanded={expanded}
            onClick={() => props.toggle(kind)}
          >
            {content}
          </button>
        ) : (
          <span
            className="activity-counter"
            key={kind}
            role="img"
            aria-label={name}
            title={title}
          >
            {content}
          </span>
        );
      })}
      {status && (
        <span className="sr-only" role="status">
          {status}
        </span>
      )}
    </div>
  );
}
