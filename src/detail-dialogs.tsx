import { heritageSize } from './object-sizes.ts';
import { heritageTier } from './heritage-scale.ts';
import { WorldArt } from './world-art.tsx';
import { useState } from 'react';
import {
  ChevronRight,
  ExternalLink,
  Trash2,
  GitPullRequest,
  X,
} from 'lucide-react';
import type { PullQuest, Quest, Region } from '../server/model.ts';
import {
  AdventurerGlyph,
  AdventurerParty,
  agentNames,
  MonsterGlyph,
  partyLabel,
} from './characters.tsx';
import { ActivityAura } from './activity-effects.tsx';
import { facilities, FacilityGlyph } from './facility-art.tsx';
import { facilityKind, isCurrentFacility } from './facility-kind.ts';
import { heritageBuildings } from './heritage-arc.tsx';
import type { HeritageMetric, HeritageRecord } from '../server/heritage.ts';
import type { Snapshot } from './snapshot.ts';
import { alerts } from './snapshot.ts';
import {
  monsterRest,
  MonsterStatusIcons,
  pullStatus,
  partyLeaderState,
  Badge,
  IssueBadge,
} from './map-markers.tsx';
import { releaseTime, OutLink, ResultLink, Dialog } from './dialog.tsx';
import {
  useActivityBrowser,
  ActivityBrowser,
  useActivitySummary,
  ActivityTotals,
} from './activity-browser.tsx';

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
  const [activityPull, setActivityPull] = useState<number>();
  const [visitedPulls, setVisitedPulls] = useState<number[]>([]);
  return (
    <Dialog title={`이슈 #${quest.number}`} titleHref={quest.url} close={close}>
      <h3>{quest.title}</h3>
      <div className="battle-scene">
        {(['codex', 'claude'] as const).map((agent) => {
          const member = quest.adventurers?.find(
            (item) => item.agent === agent,
          );
          return (
            member && (
              <div
                className={`battle-adventurer ${agent}`}
                key={agent}
                title={partyLabel(member, monsterRest(quest))}
                aria-label={partyLabel(member, monsterRest(quest))}
              >
                <AdventurerGlyph
                  agent={agent}
                  active={member.active}
                  fallen={member.fallen}
                />
              </div>
            )
          );
        })}
        <div className="battle-monster">
          <ActivityAura activity={quest.activity}>
            <MonsterGlyph
              boss={Boolean(quest.subIssueCount)}
              defeated={quest.state === 'closed'}
              reopened={quest.reopened}
              commits={quest.activity?.commits}
            />
          </ActivityAura>
          <small className="expedition-number">{`#${quest.number}`}</small>
          <MonsterStatusIcons quest={quest} />
        </div>
      </div>
      <ActivityTotals
        key={`${region.slug}:${quest.number}:${quest.pulls.map(({ number }) => number).join(',')}`}
        region={region.slug}
        token={token}
        issue={quest.number}
        pulls={quest.pulls.map(({ number }) => number).join(',')}
        initial={quest.activity}
      />
      <IssueBadge quest={quest} />
      {quest.stateReason === 'not_planned' && (
        <p>GitHub 종료 사유 · 작업하지 않기로 함</p>
      )}
      {quest.stateReason === 'duplicate' && <p>GitHub 종료 사유 · 중복</p>}
      {(quest.reason || quest.detail) && (
        <div className={`reason ${alerts.has(quest.stage) ? 'danger' : ''}`}>
          <p>{quest.reason}</p>
          {quest.detail && <p>{quest.detail}</p>}
        </div>
      )}
      {quest.evidence && <OutLink item={quest.evidence} />}
      {Boolean(quest.adventurers?.length) && (
        <>
          <h4>모험가 파티</h4>
          <AdventurerParty
            members={quest.adventurers ?? []}
            resting={monsterRest(quest)}
            detailed
          />
        </>
      )}
      {quest.review && (
        <p>
          현재 커밋의 AI 리뷰 결과 <strong>{quest.review}</strong>
        </p>
      )}
      <ActivityBrowser
        region={region.slug}
        number={quest.number}
        token={token}
        kinds={['comments']}
        counts={{ comments: quest.issueComments }}
      />
      {(quest.pulls.length > 0 || quest.commit) && <h4>공략 결과</h4>}
      {quest.commit && <ResultLink item={quest.commit} />}
      {quest.pulls.map((item) => (
        <div key={item.number}>
          <div className="result-row">
            <ResultLink
              item={{ ...item, title: `PR #${item.number} · ${item.title}` }}
            />
            <button
              className="text-button result-review"
              title={
                activityPull === item.number ? 'PR 활동 접기' : 'PR 활동 보기'
              }
              aria-label={
                activityPull === item.number ? 'PR 활동 접기' : 'PR 활동 보기'
              }
              aria-expanded={activityPull === item.number}
              onClick={() => {
                if (!visitedPulls.includes(item.number))
                  setVisitedPulls([...visitedPulls, item.number]);
                setActivityPull(
                  activityPull === item.number ? undefined : item.number,
                );
              }}
            >
              <GitPullRequest size={16} aria-hidden="true" />
            </button>
          </div>
          {visitedPulls.includes(item.number) && (
            <div hidden={activityPull !== item.number}>
              <ActivityBrowser
                key={item.number}
                region={region.slug}
                number={item.number}
                counts={item.activities}
                token={token}
              />
            </div>
          )}
        </div>
      ))}
      {quest.runs.length > 0 && <h4>GitHub Actions</h4>}
      {quest.runs.map((item) => (
        <OutLink key={item.url} item={item} />
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
  const author = pull.author && agentNames[pull.author];
  const reviewer = pull.reviewer && agentNames[pull.reviewer];
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
      <PullStatus pull={pull} />
      {status && <small role="status">{status}</small>}
      {entries}
      <AdventurerParty
        members={pull.adventurers ?? []}
        leader={partyLeaderState(pull)}
        resting="대기"
        detailed
        forge
      />
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
      {author && <p>작성 · {author}</p>}
      {reviewer && (
        <p>
          리뷰 기록 · {reviewer} {pull.review}
        </p>
      )}
      {pull.runs.map((run) => (
        <OutLink key={run.url} item={run} />
      ))}
    </Dialog>
  );
}

export function PullStatus({ pull }: { pull: PullQuest }) {
  if (pull.cancelled)
    return (
      <span className="badge idle">
        <X size={14} aria-hidden="true" /> 작업 취소
      </span>
    );
  if (pull.stage === 'idle') return null;
  return alerts.has(pull.stage) ||
    pull.stage === 'ci' ||
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
        <p>조회된 열린 PR이 없습니다.</p>
      )}
      {facilityHistory.length > 0 && (
        <details className="facility-history">
          <summary>시설 이력</summary>
          <FacilityRows entries={facilityHistory} openPull={openPull} />
          <OutLink
            item={{
              title: 'GitHub에서 종료된 PR 보기',
              url: `https://github.com/${region.slug}/pulls?q=is%3Apr+is%3Aclosed`,
            }}
          />
        </details>
      )}
    </Dialog>
  );
}

// Report warnings that can leave the release history missing or out of date.
// The labels are set where the report is loaded, in server/github-report.ts.
const releaseWarnings = new Set([
  '배포',
  '배포 상태',
  'Actions',
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
  const report = snapshot?.report;
  const warnings =
    report?.warnings.filter((label) => releaseWarnings.has(label)) ?? [];
  if (confirmRemoval) {
    return (
      <Dialog
        key="confirm-removal"
        title="월드맵에서 제거"
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
      {report &&
        !report.releases.length &&
        !warnings.length &&
        !snapshot?.error && <p>배포 기록이 없습니다.</p>}
      {!!report?.releases.length && (
        <>
          <h4>
            왕국 배포 기록 <small>(KST)</small>
          </h4>
          <div className="release-history">
            {report.releases.map((release, index) => {
              const status = release.status?.split(' · ')[0];
              return (
                <a
                  className="release-row"
                  key={index}
                  href={release.url}
                  target="_blank"
                  rel="noreferrer"
                  title={[release.title, release.status]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  {release.at && Number.isFinite(Date.parse(release.at)) ? (
                    <time dateTime={release.at}>
                      {releaseTime.format(new Date(release.at))}
                    </time>
                  ) : (
                    <span>시각 미확인</span>
                  )}
                  <span className={`badge ${release.stage}`}>
                    {status === 'failure' ? 'failed' : status || '미확인'}
                  </span>
                  <span className="release-name">{release.title}</span>
                </a>
              );
            })}
          </div>
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
