export function installTouchPress() {
  const listeners = new AbortController();
  const options = { capture: true, passive: true, signal: listeners.signal };
  let press: { button: HTMLButtonElement; pointerId: number } | undefined;

  function clearPress() {
    press?.button.removeAttribute('data-touch-pressed');
    press = undefined;
  }

  function startPress(event: PointerEvent) {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    clearPress();
    if (!(event.target instanceof Element)) return;

    const button = event.target.closest('button, a');
    if (!(button instanceof HTMLButtonElement) || button.matches(':disabled')) {
      return;
    }

    // Touch browsers can defer :active; show feedback as soon as contact starts.
    press = { button, pointerId: event.pointerId };
    button.setAttribute('data-touch-pressed', '');
  }

  function endPress(event: PointerEvent) {
    if (event.pointerId === press?.pointerId) clearPress();
  }

  document.addEventListener('pointerdown', startPress, options);
  document.addEventListener('pointerup', endPress, options);
  document.addEventListener('pointercancel', endPress, options);
  window.addEventListener('blur', clearPress, { signal: listeners.signal });

  return () => {
    listeners.abort();
    clearPress();
  };
}
