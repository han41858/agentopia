import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Region, Report } from '../server/model.ts';
import type { RefreshConsumption } from '../server/github-debug.ts';
import { nextRefreshInterval, refreshDue } from './refresh.ts';
import { RequestError, request } from './request.ts';
import {
  activeStages,
  partyStates,
  reportForges,
  reportSnapshot,
  withCachedHistory,
} from './snapshot.ts';
import type { Snapshot } from './snapshot.ts';

export type RefreshJobs = {
  token: string;
  jobs: Map<
    string,
    {
      last: number;
      interval: number;
      report?: Report;
      ticket?: string;
      branchCheckedAt?: number;
      historyCheckedAt?: number;
    }
  >;
};
export type RefreshUsage = {
  token: string;
  usage: RefreshConsumption;
  stale: boolean;
};

export function useRegionRefresh({
  token,
  worldRegions,
  refreshInterval,
  refresh,
  refreshJobs,
  setLoading,
  setProgress,
  setRefreshUsage,
  setSnapshots,
}: {
  token: string;
  worldRegions: Region[];
  refreshInterval: number;
  refresh: RefObject<(() => void) | null>;
  refreshJobs: RefObject<RefreshJobs>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setProgress: Dispatch<SetStateAction<{ duration: number; key: number }>>;
  setRefreshUsage: Dispatch<SetStateAction<RefreshUsage | undefined>>;
  setSnapshots: Dispatch<SetStateAction<Record<string, Snapshot>>>;
}) {
  useEffect(() => {
    const controller = new AbortController();
    if (refreshJobs.current.token !== token)
      refreshJobs.current = { token, jobs: new Map() };
    const jobs = refreshJobs.current.jobs;
    const slugs = new Set(worldRegions.map(({ slug }) => slug));
    for (const slug of jobs.keys()) if (!slugs.has(slug)) jobs.delete(slug);
    const pending = new Set<string>();
    let forceRequested = false;
    let nextBatch = 0;
    let publishedBatch = 0;
    let timer: number | undefined;

    function schedule() {
      window.clearTimeout(timer);
      if (controller.signal.aborted) return;
      setLoading(pending.size > 0);
      const now = Date.now();
      const hidden = document.visibilityState !== 'visible';
      let next = Infinity;
      if (forceRequested) {
        if (pending.size) return;
        forceRequested = false;
        void syncBatch([...slugs], true);
      } else {
        const dueSlugs: string[] = [];
        for (const slug of slugs) {
          if (pending.has(slug)) continue;
          const job = jobs.get(slug);
          const due = job ? refreshDue(job.last, job.interval, hidden) : now;
          if (due <= now) dueSlugs.push(slug);
          else next = Math.min(next, due);
        }
        if (dueSlugs.length) void syncBatch(dueSlugs, false);
      }
      setLoading(pending.size > 0);
      if (Number.isFinite(next)) {
        const duration = Math.max(1, next - now);
        timer = window.setTimeout(schedule, duration);
        setProgress((previous) => ({ duration, key: previous.key + 1 }));
      }
    }

    async function syncBatch(batch: string[], force: boolean) {
      if (!batch.length) return;
      const id = ++nextBatch;
      const usages = await Promise.all(batch.map((slug) => sync(slug, force)));
      if (controller.signal.aborted || id < publishedBatch) return;
      publishedBatch = id;
      const limits = new Set(
        usages.flatMap((usage) =>
          usage?.limit === undefined ? [] : [usage.limit],
        ),
      );
      const consumed =
        limits.size <= 1 &&
        usages.every((usage) => usage?.consumed !== undefined)
          ? usages.reduce((sum, usage) => sum + (usage?.consumed ?? 0), 0)
          : undefined;
      setRefreshUsage((previous) => {
        const last = previous?.token === token ? previous.usage : undefined;
        if (consumed === undefined)
          return {
            token,
            usage: last ?? {},
            stale: last?.consumed !== undefined,
          };
        return {
          token,
          usage: {
            consumed,
            limit:
              limits.size === 1 ? limits.values().next().value : last?.limit,
          },
          stale: false,
        };
      });
    }

    async function sync(slug: string, force: boolean) {
      pending.add(slug);
      const previous = jobs.get(slug);
      const checkBranches =
        force ||
        Date.now() - (previous?.branchCheckedAt ?? -Infinity) >= 120_000;
      const branchCheckedAt = checkBranches
        ? Date.now()
        : previous?.branchCheckedAt;
      const cachedHistory =
        token &&
        !force &&
        Date.now() - (previous?.historyCheckedAt ?? -Infinity) < 120_000
          ? previous?.report
          : undefined;
      let usage: RefreshConsumption | undefined;
      try {
        const params = new URLSearchParams({ repo: slug, measure: 'refresh' });
        if (force) params.set('refresh', '1');
        if (checkBranches) params.set('branches', '1');
        if (cachedHistory) params.set('history', 'cached');
        const { refreshTicket, ...fetched } = await request<
          Report & { refreshTicket?: string }
        >(
          params,
          token,
          controller.signal,
          (measured) => {
            usage = measured;
          },
          token ? (previous?.ticket ?? '') : undefined,
        );
        if (controller.signal.aborted) return;
        const report = cachedHistory
          ? withCachedHistory(fetched, cachedHistory)
          : fetched;
        const prior = previous?.report && partyStates(previous.report);
        const current = partyStates(report);
        const changed =
          !prior ||
          prior.size !== current.size ||
          [...current].some(([key, value]) => prior.get(key) !== value) ||
          JSON.stringify(previous?.report?.releases) !==
            JSON.stringify(report.releases);
        const active =
          report.quests.some(({ stage }) => activeStages.has(stage)) ||
          reportForges(report).some(({ stage }) => activeStages.has(stage)) ||
          report.releases.some(({ stage }) => activeStages.has(stage));
        const interval = nextRefreshInterval(
          refreshInterval,
          previous?.interval ?? refreshInterval,
          Boolean(active) || report.warnings.length > 0,
          changed,
        );
        const historyCheckedAt = cachedHistory
          ? previous?.historyCheckedAt
          : report.warnings.some((label) =>
                ['릴리스', '태그', '릴리스 커밋'].includes(label),
              )
            ? undefined
            : Date.now();
        jobs.set(slug, {
          last: Date.now(),
          report,
          ticket: refreshTicket,
          interval,
          branchCheckedAt,
          historyCheckedAt,
        });
        setSnapshots((current) => ({
          ...current,
          [slug]: reportSnapshot(report, current[slug]),
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        const denied =
          Boolean(token) &&
          error instanceof RequestError &&
          !error.rateLimited &&
          [401, 403, 404].includes(error.status);
        jobs.set(slug, {
          last: Date.now(),
          interval: refreshInterval,
          report: denied ? undefined : previous?.report,
          ticket: denied ? undefined : previous?.ticket,
          branchCheckedAt,
        });
        setSnapshots((current) => ({
          ...current,
          [slug]: {
            ...(denied ? { accessDenied: true } : current[slug]),
            error: (error as Error).message,
            httpStatus:
              error instanceof RequestError ? error.status : undefined,
          },
        }));
      } finally {
        pending.delete(slug);
        schedule();
      }
      return usage;
    }

    refresh.current = () => {
      forceRequested = true;
      schedule();
    };
    schedule();
    document.addEventListener('visibilitychange', schedule);
    return () => {
      refresh.current = null;
      document.removeEventListener('visibilitychange', schedule);
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [token, worldRegions, refreshInterval]);
}
