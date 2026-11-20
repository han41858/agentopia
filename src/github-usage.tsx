import { useEffect, useId, useRef, useState } from 'react';
import type {
  CoreUsage,
  GitHubDebugSnapshot,
  RefreshConsumption,
} from '../server/github-debug.ts';

const formatNumber = (value?: number) => value?.toLocaleString('ko-KR') ?? '—';
const resetTime = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Seoul',
});

type UsageListener = (token: string, snapshot?: GitHubDebugSnapshot) => void;
const usageListeners = new Set<UsageListener>();

export function publishGitHubUsage(
  token: string,
  snapshot?: GitHubDebugSnapshot,
) {
  for (const listener of usageListeners) listener(token, snapshot);
}

export function GitHubUsage({
  token,
  refresh,
  refreshStale = false,
}: {
  token: string;
  refresh?: RefreshConsumption;
  refreshStale?: boolean;
}) {
  const [reading, setReading] = useState<{ token: string; core?: CoreUsage }>();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const label = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const open = hover || focus || pinned;

  useEffect(() => {
    const update: UsageListener = (scope, snapshot) => {
      if (scope !== token || !snapshot) return;
      const core = snapshot.core;
      setReading((previous) => {
        const old = previous?.token === token ? previous.core : undefined;
        const older =
          old?.reset !== undefined &&
          (core?.reset === undefined ||
            core.reset < old.reset ||
            (core.reset === old.reset && (core.used ?? -1) < (old.used ?? -1)));
        return { token, core: older ? old : (core ?? old) };
      });
    };
    usageListeners.add(update);
    return () => {
      usageListeners.delete(update);
    };
  }, [token]);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent | KeyboardEvent) {
      if (
        (event instanceof KeyboardEvent && event.key === 'Escape') ||
        (event instanceof PointerEvent &&
          event.target instanceof Node &&
          !wrapper.current?.contains(event.target))
      ) {
        setHover(false);
        setFocus(false);
        setPinned(false);
      }
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
    };
  }, [open]);

  if (!reading || reading.token !== token) return null;
  const { limit, used, remaining, reset } = reading.core ?? {};
  const coreStale = reset !== undefined && reset * 1000 <= Date.now();
  const measuredUsed =
    used ??
    (limit !== undefined && remaining !== undefined && remaining <= limit
      ? limit - remaining
      : undefined);
  const utilization =
    limit && measuredUsed !== undefined
      ? `${((100 * measuredUsed) / limit).toFixed(1)}%`
      : '—';
  const refreshLimit = refresh?.limit ?? limit;
  const rate =
    refresh?.consumed !== undefined && refreshLimit
      ? `+${((100 * refresh.consumed) / refreshLimit).toFixed(1)}%`
      : '—';
  const resetLabel =
    reset !== undefined && reset <= 8.64e12
      ? resetTime.format(reset * 1000)
      : '—';

  return (
    <div
      ref={wrapper}
      className="github-usage"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setHover(true);
      }}
      onPointerLeave={() => setHover(false)}
    >
      <button
        type="button"
        className="github-usage-value"
        aria-label={`GitHub API 사용량 ${rate} · ${utilization}`}
        aria-describedby={open ? label : undefined}
        aria-expanded={open}
        onFocus={(event) =>
          setFocus(event.currentTarget.matches(':focus-visible'))
        }
        onBlur={() => setFocus(false)}
        onClick={() => setPinned(!pinned)}
      >
        {rate} · {utilization}
      </button>
      {open && (
        <div id={label} className="github-usage-tooltip" role="tooltip">
          <dl>
            <dt>{refreshStale ? '마지막 확인 소비량' : '직전 갱신 소비량'}</dt>
            <dd>
              {formatNumber(refresh?.consumed)} · {rate}
            </dd>
            <dt>Core API 전체 한도</dt>
            <dd>{formatNumber(limit)}</dd>
            <dt>사용량</dt>
            <dd>{formatNumber(measuredUsed)}</dd>
            <dt>잔여량</dt>
            <dd>{formatNumber(remaining)}</dd>
            <dt>초기화 시각</dt>
            <dd>{resetLabel}</dd>
          </dl>
          {refreshStale && <small>직전 갱신의 소비량은 미확인입니다.</small>}
          {coreStale && <small>한도 초기화 전 마지막 확인값입니다.</small>}
          <small>같은 계정의 다른 API 사용량이 포함될 수 있습니다.</small>
        </div>
      )}
    </div>
  );
}
