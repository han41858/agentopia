import { useState, useRef, useEffect } from 'react';
const narrowHeaderQuery = '(max-width: 640px)';
export function useHeaderTools() {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [narrowHeader, setNarrowHeader] = useState(
    () => window.matchMedia(narrowHeaderQuery).matches,
  );
  const headerTools = useRef<HTMLDivElement>(null);
  const bookmark = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const media = window.matchMedia(narrowHeaderQuery);

    function syncHeader(matches: boolean) {
      setNarrowHeader(matches);
      if (!matches) setToolsOpen(false);
    }

    function onChange(event: MediaQueryListEvent) {
      syncHeader(event.matches);
    }

    media.addEventListener('change', onChange);
    syncHeader(media.matches);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!narrowHeader || !toolsOpen) return;

    function dismissOutside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !headerTools.current?.contains(event.target)
      ) {
        setToolsOpen(false);
      }
    }

    function dismissOnEscape(event: KeyboardEvent) {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        document.querySelector('dialog[open]')
      )
        return;
      event.preventDefault();
      setToolsOpen(false);
      bookmark.current?.focus();
    }

    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [narrowHeader, toolsOpen]);

  return { toolsOpen, setToolsOpen, narrowHeader, headerTools, bookmark };
}
