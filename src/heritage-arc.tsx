import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Archive,
  BookOpen,
  CircleHelp,
  Crown,
  Flag,
  Landmark,
  ScrollText,
} from 'lucide-react';
import { heritageKeys } from '../server/heritage.ts';
import type {
  Heritage,
  HeritageMetric,
  HeritageRecord,
} from '../server/heritage.ts';
import { FacilityGlyph } from './facility-art.tsx';
import type { FacilityKind } from './facility-kind.ts';
import { heritageTier } from './heritage-scale.ts';

export const heritageBuildings = {
  issues: {
    title: '몬스터 도감',
    label: '전체 이슈',
    kind: 'training',
    Emblem: BookOpen,
  },
  closedIssues: {
    title: '영웅의 전당',
    label: '종료된 이슈',
    kind: 'workshop',
    Emblem: Crown,
  },
  pulls: {
    title: '건축 연대기',
    label: '전체 PR',
    kind: 'repair',
    Emblem: ScrollText,
  },
  mergedPulls: {
    title: '완공 기념비',
    label: '머지된 PR',
    kind: 'guard',
    Emblem: Flag,
  },
  commits: {
    title: '역사의 탑',
    label: '전체 커밋',
    kind: 'machine',
    Emblem: Landmark,
  },
  reviews: {
    title: '현자의 서고',
    label: '전체 리뷰',
    kind: 'library',
    Emblem: BookOpen,
  },
  comments: {
    title: '기록 보관소',
    label: '전체 댓글',
    kind: 'wall',
    Emblem: Archive,
  },
} satisfies Record<
  HeritageMetric,
  { title: string; label: string; kind: FacilityKind; Emblem: typeof BookOpen }
>;

const historyInterval = 30 * 60_000;

export function HeritageArc({
  slug,
  name,
  token,
  load,
  open,
  onLoad,
}: {
  slug: string;
  name: string;
  token: string;
  load: (slug: string, token: string, signal: AbortSignal) => Promise<Heritage>;
  open: (metric: HeritageMetric, record?: HeritageRecord) => void;
  onLoad: (slug: string, data: Heritage) => void;
}) {
  const [snapshot, setSnapshot] = useState<{ token: string; data: Heritage }>();
  const element = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let nearViewport = typeof IntersectionObserver === 'undefined';
    let inFlight = false;
    let lastRequest = -Infinity;
    let timer: number | undefined;

    function schedule() {
      window.clearTimeout(timer);
      if (
        controller.signal.aborted ||
        inFlight ||
        !nearViewport ||
        document.hidden
      )
        return;
      const remaining = lastRequest + historyInterval - Date.now();
      if (remaining > 0) {
        timer = window.setTimeout(schedule, remaining);
        return;
      }
      inFlight = true;
      lastRequest = Date.now();
      void load(slug, token, controller.signal)
        .then(
          (data) => {
            if (!controller.signal.aborted) {
              setSnapshot((previous) => ({
                token,
                data: {
                  ...(previous?.token === token ? previous.data : {}),
                  ...data,
                },
              }));
            }
            onLoad(slug, data);
          },
          () => {
            // Each building keeps its last confirmed value or stays unverified.
          },
        )
        .finally(() => {
          inFlight = false;
          schedule();
        });
    }

    const observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(
            ([entry]) => {
              nearViewport = entry.isIntersecting;
              schedule();
            },
            { rootMargin: '220px' },
          );
    if (element.current) observer?.observe(element.current);
    document.addEventListener('visibilitychange', schedule);
    schedule();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [slug, token, load, onLoad]);

  const data = snapshot?.token === token ? snapshot.data : undefined;
  return (
    <div
      ref={element}
      className="heritage-arc"
      role="group"
      aria-label={`${name}의 유산`}
    >
      {heritageKeys.map((metric) => {
        const { title, kind, Emblem } = heritageBuildings[metric];
        const record = data?.[metric];
        const tier = heritageTier(metric, record?.count);
        return (
          <button
            key={metric}
            type="button"
            className="heritage-slot"
            data-metric={metric}
            data-known={record !== undefined}
            data-tier={tier}
            title={title}
            aria-label={record ? title : `${title} · 미확인`}
            onClick={() => open(metric, record)}
          >
            <span
              className="heritage-building"
              style={{ '--heritage-tier': tier } as CSSProperties}
              aria-hidden="true"
            >
              <span className="heritage-sprite">
                <FacilityGlyph kind={kind} />
                {record ? (
                  <Emblem className="heritage-emblem" size={11} />
                ) : (
                  <CircleHelp className="heritage-emblem" size={11} />
                )}
              </span>
              {tier > 1 && <span className="heritage-plinth" />}
              {tier > 3 && <span className="heritage-plinth upper" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
