import { heritageSize } from './object-sizes.ts';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { heritageKeys } from '../server/heritage.ts';
import type {
  Heritage,
  HeritageMetric,
  HeritageRecord,
} from '../server/heritage.ts';
import { WorldArt, type WorldSprite } from './world-art.tsx';
import { heritageTier } from './heritage-scale.ts';

export const heritageBuildings = {
  mergedPulls: {
    title: '완공 기념비',
    label: '머지된 PR',
    sprite: 'legacyMonument',
  },
  resolvedIssues: {
    title: '영웅의 전당',
    label: '해결된 이슈',
    sprite: 'legacyHallOfHeroes',
  },
  reviews: {
    title: '현자의 서고',
    label: '전체 리뷰',
    sprite: 'legacySageLibrary',
  },
  comments: {
    title: '기록 보관소',
    label: '전체 댓글',
    sprite: 'legacyArchive',
  },
} satisfies Record<
  HeritageMetric,
  { title: string; label: string; sprite: WorldSprite }
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
  const visible = heritageKeys.flatMap((metric, index) => {
    const record = data?.[metric];
    return record && record.count > 0 ? [{ metric, index, record }] : [];
  });
  return (
    <div
      ref={element}
      className="heritage-arc"
      role={visible.length ? 'group' : undefined}
      aria-label={visible.length ? `${name}의 유산` : undefined}
    >
      {visible.map(({ metric, index, record }) => {
        const tier = heritageTier(metric, record.count);
        const { title, sprite } = heritageBuildings[metric];
        const offset =
          index === 0 || index === heritageKeys.length - 1 ? 12 : 0;
        return (
          <button
            key={metric}
            type="button"
            className="heritage-slot"
            data-metric={metric}
            data-tier={tier}
            title={title}
            aria-label={title}
            style={
              {
                gridColumn: index + 1,
                '--arc-drop': `${offset}px`,
              } as CSSProperties
            }
            onClick={() => open(metric, record)}
          >
            <span className="heritage-building" aria-hidden="true">
              <WorldArt
                sprite={sprite}
                size={heritageSize(tier)}
                className="facility-sprite"
              />
              {tier >= 2 && <span className="heritage-plinth" />}
              {tier > 3 && <span className="heritage-plinth upper" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
