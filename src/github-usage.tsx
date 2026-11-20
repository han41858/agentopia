import { useEffect, useId, useRef, useState } from 'react';
import type { GitHubDebugSnapshot } from '../server/github-debug.ts';

const formatNumber = (value?: number) => value?.toLocaleString('ko-KR') ?? '—';
const resetTime = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Seoul',
});

export function GitHubUsage({ token }: { token: string }) {
  const [reading, setReading] = useState<{
    token: string;
    snapshot?: GitHubDebugSnapshot;
  }>();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const label = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const open = hover || focus || pinned;

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let pending = false;
    let available = true;
    async function poll() {
      window.clearTimeout(timer);
      if (!available || pending || document.hidden || controller.signal.aborted)
        return;
      pending = true;
      try {
        const response = await fetch('/api/github?debug=usage', {
          signal: controller.signal,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (controller.signal.aborted) return;
        if (response.status === 404) {
          available = false;
          setReading(undefined);
        } else if (response.ok) {
          const snapshot: GitHubDebugSnapshot = await response.json();
          if (!controller.signal.aborted) setReading({ token, snapshot });
        } else {
          setReading((current) =>
            current?.token === token ? { token } : undefined,
          );
        }
      } catch {
        if (!controller.signal.aborted)
          setReading((current) =>
            current?.token === token ? { token } : undefined,
          );
      } finally {
        pending = false;
        if (available && !document.hidden && !controller.signal.aborted)
          timer = window.setTimeout(poll, 2500);
      }
    }
    void poll();
    document.addEventListener('visibilitychange', poll);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', poll);
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
  const { snapshot } = reading;
  const { limit, used, remaining, reset } = snapshot?.core ?? {};
  const measuredUsed =
    used ??
    (limit !== undefined && remaining !== undefined && remaining <= limit
      ? limit - remaining
      : undefined);
  const utilization =
    limit && measuredUsed !== undefined
      ? `${((100 * measuredUsed) / limit).toFixed(1)}%`
      : '—';
  const rate = snapshot ? `${snapshot.requestsPerSecond.toFixed(1)}/s` : '—';
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
            <dt>최근 60초 평균</dt>
            <dd>{rate}</dd>
            <dt>Core API 전체 한도</dt>
            <dd>{formatNumber(limit)}</dd>
            <dt>사용량</dt>
            <dd>{formatNumber(measuredUsed)}</dd>
            <dt>잔여량</dt>
            <dd>{formatNumber(remaining)}</dd>
            <dt>초기화 시각</dt>
            <dd>{resetLabel}</dd>
          </dl>
          <small>같은 계정의 다른 API 사용량이 포함될 수 있습니다.</small>
        </div>
      )}
    </div>
  );
}
