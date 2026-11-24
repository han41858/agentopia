import { heritageSize } from './object-sizes.ts';
import { heritageTier } from './heritage-scale.ts';
import { WorldArt } from './world-art.tsx';
import { useState } from 'react';
import { ChevronRight, ExternalLink, Trash2, X } from 'lucide-react';
import type {
  WorkflowRunRecord,
  PullQuest,
  Quest,
  Region,
} from '../server/model.ts';
import { facilities, FacilityGlyph } from './facility-art.tsx';
import { facilityKind, isCurrentFacility } from './facility-kind.ts';
import { heritageBuildings } from './heritage-arc.tsx';
import type { HeritageMetric, HeritageRecord } from '../server/heritage.ts';
import type { Snapshot } from './snapshot.ts';
import { alerts } from './snapshot.ts';
import { pullStatus, Badge } from './map-markers.tsx';
import { releaseTime, OutLink, ResultLink, Dialog } from './dialog.tsx';
import {
  useActivityBrowser,
  ActivityEntries,
  useActivitySummary,
  IssueActivityCounters,
  IssuePullEntries,
} from './activity-browser.tsx';
import type { IssueActivityKind } from './activity-browser.tsx';
import './workflow-runs.css';

function WorkflowRuns({
  runs,
  evidenceUrl,
}: {
  runs: WorkflowRunRecord[];
  evidenceUrl?: string;
}) {
  if (!runs.length) return null;

  return (
    <section className="workflow-runs" aria-label="GitHub Actions">
      <h4>GitHub Actions</h4>
      <ul
        className="workflow-runs-list"
        aria-label="GitHub Actions 실행 목록"
        tabIndex={0}
      >
        {runs.map(({ url, title, status, startedAt }) => (
          <li key={url} className="workflow-run-row">
            {startedAt && Number.isFinite(Date.parse(startedAt)) ? (
              <time dateTime={startedAt}>
                {releaseTime.format(new Date(startedAt))} KST
              </time>
            ) : (
              <span>—</span>
            )}
            <span
              className="workflow-run-status"
              data-run-status={status}
              title={status || undefined}
            >
              {status || '—'}
            </span>
            {url === evidenceUrl && <span>근거</span>}
            <a href={url} title={title} target="_blank" rel="noreferrer">
              <span>{title}</span>
              <ExternalLink size={11} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function QuestDetail({
  quest,
  region,
  token,
  close,
}: {
  quest: Quest;
  region: Region;
  token: string;
  close: () => void;
}) {
  const [selected, setSelected] = useState<IssueActivityKind>();
  const [visited, setVisited] = useState<IssueActivityKind[]>([]);
  const evidence = quest.evidence;
  const runsByUrl = new Map(quest.runs.map((run) => [run.url, run]));
  const evidenceRun = evidence && runsByUrl.get(evidence.url);
  if (evidenceRun) runsByUrl.delete(evidenceRun.url);
  const runs = evidenceRun
    ? [evidenceRun, ...runsByUrl.values()]
    : [...runsByUrl.values()];
  return (
    <Dialog
      className="issue-dialog"
      title={`이슈 #${quest.number}`}
      titleHref={quest.url}
      showLinkIcon={false}
      headingActions={
        <IssueActivityCounters
          key={`${region.slug}:${quest.number}:${quest.pulls.map(({ number }) => number).join(',')}`}
          region={region.slug}
          token={token}
          issue={quest.number}
          pulls={quest.pulls.map(({ number }) => number).join(',')}
          initial={quest.activity}
          fallbackComments={quest.issueComments}
          selected={selected}
          toggle={(kind) => {
            setVisited((previous) =>
              previous.includes(kind) ? previous : [...previous, kind],
            );
            setSelected((current) => (current === kind ? undefined : kind));
          }}
        />
      }
      close={close}
    >
      <h3>{quest.title}</h3>
      {quest.stage === 'failed' && <Badge stage={quest.stage} />}
      {quest.stateReason === 'not_planned' && (
        <p>GitHub 종료 사유 · 작업하지 않기로 함</p>
      )}
      {quest.stateReason === 'duplicate' && <p>GitHub 종료 사유 · 중복</p>}
      {(quest.reason || quest.detail) && (
        <div className={`reason ${alerts.has(quest.stage) ? 'danger' : ''}`}>
          {quest.reason && <p>{quest.reason}</p>}
          {quest.detail && <p>{quest.detail}</p>}
        </div>
      )}
      {evidence && !evidenceRun && (
        <OutLink
          item={evidence}
          statusBadge={
            evidence.title === 'GitHub Actions 상태 기록' && evidence.status ? (
              <span
                className="workflow-run-status"
                data-automation-status={evidence.status}
              >
                {evidence.status}
              </span>
            ) : undefined
          }
        />
      )}
      <WorkflowRuns runs={runs} evidenceUrl={evidenceRun?.url} />
      {quest.review && (
        <p>
          현재 커밋의 AI 리뷰 결과 <strong>{quest.review}</strong>
        </p>
      )}
      {visited.map((kind) => (
        <div key={kind} hidden={selected !== kind}>
          {kind === 'issueComments' ? (
            <ActivityEntries
              region={region.slug}
              number={quest.number}
              token={token}
              kind="comments"
              linkedEvidenceUrl={evidence?.url}
            />
          ) : (
            <IssuePullEntries
              region={region.slug}
              token={token}
              pulls={quest.pulls}
              kind={kind}
              linkedEvidenceUrl={evidence?.url}
            />
          )}
        </div>
      ))}
      {quest.commit && quest.commit.url !== evidence?.url && (
        <ResultLink item={quest.commit} />
      )}
      {quest.pulls
        .filter((item) => item.url !== evidence?.url)
        .map((item) => (
          <ResultLink
            key={item.number}
            item={{ ...item, title: `PR #${item.number} · ${item.title}` }}
          />
        ))}
    </Dialog>
  );
}

export function PullDetail({
  pull,
  region,
  token,
  close,
  openIssue,
}: {
  pull: PullQuest;
  region: Region;
  token: string;
  close: () => void;
  openIssue: (number: number) => boolean;
}) {
  const kind = facilityKind(pull.title);
  const iconLabel = facilities[kind].name + (pull.draft ? ' · 초안 PR' : '');
  const { activity, status } = useActivitySummary({
    region: region.slug,
    token,
    pulls: String(pull.number),
    initial: pull.activity,
  });
  const { counters, entries } = useActivityBrowser(
    {
      region: region.slug,
      number: pull.number,
      token,
      counts: {
        commits: activity?.partialCommits
          ? (pull.activities?.commits ?? activity.commits)
          : (activity?.commits ?? pull.activities?.commits),
        comments: activity?.pullComments ?? pull.activities?.comments,
        reviews: activity?.reviews ?? pull.activities?.reviews,
      },
    },
    activity?.partialCommits && pull.activities?.commits === undefined,
  );
  return (
    <Dialog
      className={pull.draft ? 'pull-dialog draft' : 'pull-dialog'}
      title={`PR #${pull.number}`}
      titleHref={pull.url}
      showLinkIcon={false}
      titleIcon={
        <span role="img" aria-label={iconLabel} title={iconLabel}>
          <FacilityGlyph kind={kind} />
        </span>
      }
      headingActions={counters}
      close={close}
    >
      <h3>{pull.title}</h3>
      <PullStatus pull={pull} detail />
      {pull.review && (
        <p>
          AI 리뷰 결과 <strong>{pull.review}</strong>
        </p>
      )}
      {status && <small role="status">{status}</small>}
      {entries}
      {!!pull.issues?.length && (
        <ul className="facility-issues" aria-label="연결된 이슈">
          {pull.issues.map((number) => (
            <li key={number}>
              <a
                className="text-button"
                href={`https://github.com/${region.slug}/issues/${number}`}
                onClick={(event) => {
                  if (
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey &&
                    openIssue(number)
                  )
                    event.preventDefault();
                }}
              >
                이슈 #{number}
              </a>
            </li>
          ))}
        </ul>
      )}
      <WorkflowRuns runs={pull.runs} />
    </Dialog>
  );
}

export function PullStatus({
  pull,
  detail = false,
}: {
  pull: PullQuest;
  detail?: boolean;
}) {
  if (pull.cancelled)
    return (
      <span className="badge idle">
        <X size={14} aria-hidden="true" /> 작업 취소
      </span>
    );
  if (pull.stage === 'idle') return null;
  return alerts.has(pull.stage) ||
    (!detail && pull.stage === 'ci') ||
    pull.stage === 'complete' ? (
    <Badge stage={pull.stage} label={pullStatus(pull)} />
  ) : (
    <span className={`badge ${pull.stage}`}>{pullStatus(pull)}</span>
  );
}

export function FacilityRows({
  entries,
  openPull,
}: {
  entries: PullQuest[];
  openPull: (pull: PullQuest) => void;
}) {
  return (
    <ul className="quest-tree">
      {entries.map((pull) => {
        const kind = facilityKind(pull.title);
        return (
          <li key={pull.number}>
            <button className="quest-row" onClick={() => openPull(pull)}>
              <span
                role="img"
                aria-label={facilities[kind].name}
                title={facilities[kind].name}
              >
                <FacilityGlyph kind={kind} />
              </span>
              <span className="quest-row-title">
                <small>PR #{pull.number}</small>
                <strong>{pull.title}</strong>
              </span>
              {!pull.merged && <PullStatus pull={pull} />}
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function PlazaDetail({
  region,
  pulls,
  title = '개발 광장',
  openPull,
  close,
}: {
  region: Region;
  pulls: PullQuest[];
  title?: string;
  openPull: (pull: PullQuest) => void;
  close: () => void;
}) {
  const current = pulls.filter(isCurrentFacility);
  const facilityHistory = pulls
    .filter((pull) => !isCurrentFacility(pull))
    .sort((left, right) =>
      (right.finishedAt ?? '').localeCompare(left.finishedAt ?? ''),
    );
  return (
    <Dialog title={title} close={close}>
      <h4>작업중</h4>
      {current.length ? (
        <FacilityRows entries={current} openPull={openPull} />
      ) : (
        <p>조회된 PR이 없습니다.</p>
      )}
      {facilityHistory.length > 0 && (
        <section className="facility-history" aria-label="시설 이력">
          <h4>시설 이력</h4>
          <FacilityRows entries={facilityHistory} openPull={openPull} />
          <OutLink
            item={{
              title: 'GitHub에서 종료된 PR 보기',
              url: `https://github.com/${region.slug}/pulls?q=is%3Apr+is%3Aclosed`,
            }}
          />
        </section>
      )}
    </Dialog>
  );
}

// Report warnings that can leave the release history missing or out of date.
// The labels are set where the report is loaded, in server/github-report.ts.
const releaseWarnings = new Set([
  '릴리스',
  '태그',
  '태그 커밋 시각',
  'GitHub API 사용 한도',
]);

export function RegionDetail({
  region,
  snapshot,
  remove,
  close,
}: {
  region: Region;
  snapshot?: Snapshot;
  remove: () => void;
  close: () => void;
}) {
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);
  const report = snapshot?.report;
  const publishedTags = new Set(
    report?.releases.map((release) => release.title),
  );
  const tagRows = (report?.tags ?? [])
    .filter((tag) => !publishedTags.has(tag.name))
    .map((tag) => ({
      title: tag.name,
      url: `https://github.com/${region.slug}/tree/${tag.name.split('/').map(encodeURIComponent).join('/')}`,
      status: '태그',
      stage: 'idle',
      at: tag.committedAt,
    }));
  const history = [...(report?.releases ?? []), ...tagRows].sort((a, b) =>
    (b.at ?? '').localeCompare(a.at ?? ''),
  );
  const warnings =
    report?.warnings.filter((label) => releaseWarnings.has(label)) ?? [];
  if (confirmRemoval) {
    return (
      <Dialog
        key="confirm-removal"
        title="월드맵에서 제거"
        showCloseButton={false}
        close={() => setConfirmRemoval(false)}
      >
        <p>{region.slug} 저장소를 월드맵에서 제거할까요?</p>
        <div className="removal-actions">
          <button
            className="text-button"
            onClick={() => setConfirmRemoval(false)}
          >
            취소
          </button>
          <button className="primary remove-region" onClick={remove}>
            제거
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={region.slug}
      className="palace-dialog"
      close={close}
      headingActions={
        <>
          <a
            className="icon-button"
            href={`https://github.com/${region.slug}`}
            target="_blank"
            rel="noreferrer"
            aria-label="저장소로 이동"
            title="저장소로 이동"
          >
            <ExternalLink size={18} aria-hidden="true" />
          </a>
          <button
            className="icon-button remove-region"
            onClick={() => setConfirmRemoval(true)}
            aria-label="월드맵에서 제거"
            title="월드맵에서 제거"
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </>
      }
    >
      {snapshot?.error && <p className="fetch-error">{snapshot.error}</p>}
      {warnings.length > 0 && (
        <p className="fetch-error">
          일부 기록을 확인하지 못했습니다 · {warnings.join(', ')}
        </p>
      )}
      {!report && !snapshot?.error && <p>배포 기록을 조회하고 있습니다.</p>}
      {report && !history.length && !warnings.length && !snapshot?.error && (
        <p>배포 기록이 없습니다.</p>
      )}
      {history.length > 0 && (
        <>
          <h4>
            왕국 배포 기록 <small>(KST)</small>
          </h4>
          <div className="release-history">
            {history.slice(0, visibleCount).map((release) => {
              const status = release.status;
              return (
                <a
                  className="release-row"
                  key={release.title}
                  href={release.url}
                  target="_blank"
                  rel="noreferrer"
                  title={[release.title, release.status]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  {release.at && Number.isFinite(Date.parse(release.at)) ? (
                    <time
                      dateTime={release.at}
                      title={
                        status === '태그'
                          ? '태그 대상 커밋 시각'
                          : '릴리스 게시 시각'
                      }
                    >
                      {releaseTime.format(new Date(release.at))}
                    </time>
                  ) : (
                    <span aria-label="시각 미확인">—</span>
                  )}
                  <span className={`badge ${release.stage}`}>
                    {status === '태그' ? '태그 · 커밋' : status}
                  </span>
                  <span className="release-name">{release.title}</span>
                </a>
              );
            })}
          </div>
          {visibleCount < history.length && (
            <button
              className="text-button"
              onClick={() => setVisibleCount((count) => count + 10)}
            >
              더 보기 ({visibleCount}/{history.length})
            </button>
          )}
          {tagRows.some((tag) => !tag.at) &&
            !warnings.includes('태그 커밋 시각') && (
              <p>
                조회 범위에서 커밋 시각을 확인할 수 없는 태그는 목록 끝에
                표시합니다.
              </p>
            )}
          {report?.tagsPartial && (
            <p>익명 조회는 GitHub가 반환한 첫 30개 태그 안에서 정렬합니다.</p>
          )}
        </>
      )}
    </Dialog>
  );
}

export type HeritageSelection = {
  region: Region;
  metric: HeritageMetric;
  record?: HeritageRecord;
};

export function HeritageDetail({
  selection,
  close,
}: {
  selection: HeritageSelection;
  close: () => void;
}) {
  const { region, metric, record } = selection;
  const { title, label, sprite } = heritageBuildings[metric];
  return (
    <Dialog title={title} close={close}>
      <div className="facility-detail">
        <WorldArt
          sprite={sprite}
          size={heritageSize(heritageTier(metric, record?.count))}
          className="facility-sprite"
        />
        <span>{region.name}</span>
      </div>
      <dl className="heritage-total">
        <dt>{label}</dt>
        <dd>{record ? record.count.toLocaleString('ko-KR') : '미확인'}</dd>
      </dl>
      {!record && <p>현재 조회 범위에서 전체 합계를 확인하지 못했습니다.</p>}
      {record?.source === 'search' && (
        <p>GitHub 검색 인덱스 기준이며 최근 변경 반영이 늦을 수 있습니다.</p>
      )}
      {metric === 'comments' && record && (
        <p>이슈·PR 대화 댓글과 PR 코드 리뷰 댓글을 합산합니다.</p>
      )}
    </Dialog>
  );
}
