const idleMaximum = 5 * 60_000;
const hiddenMinimum = 3 * 60_000;

export function nextRefreshInterval(
  base: number,
  current: number,
  busy: boolean,
  changed: boolean,
) {
  return busy || changed
    ? base
    : Math.min(idleMaximum, Math.round(current * 1.5));
}

export function refreshDue(
  lastFinished: number,
  interval: number,
  hidden: boolean,
) {
  return (
    lastFinished + (hidden ? Math.max(hiddenMinimum, interval * 3) : interval)
  );
}
