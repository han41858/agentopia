import { useLayoutEffect, useRef } from 'react';

export function KingdomWall() {
  const ref = useRef<SVGSVGElement>(null);

  useLayoutEffect(() => {
    const wall = ref.current;
    const area = wall?.parentElement;
    if (!wall || !area) return;
    const shapes = wall.querySelectorAll('rect');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let previous: { width: number; height: number } | undefined;
    let motion: Animation | undefined;

    function measure() {
      if (!wall || !area) return;
      const width = area.offsetWidth;
      const height = area.offsetHeight;
      if (
        !width ||
        !height ||
        (previous?.width === width && previous.height === height)
      )
        return;
      const insideWidth = Math.max(1, width - 16);
      const insideHeight = Math.max(1, height - 16);
      wall.setAttribute('viewBox', `0 0 ${width} ${height}`);
      for (const shape of shapes) {
        shape.setAttribute('width', String(insideWidth));
        shape.setAttribute('height', String(insideHeight));
        shape.setAttribute('rx', String(insideWidth * 0.48));
        shape.setAttribute('ry', String(Math.min(insideHeight * 0.48, 104)));
      }
      motion?.cancel();
      if (
        previous &&
        !reducedMotion.matches &&
        typeof wall.animate === 'function'
      ) {
        motion = wall.animate(
          [
            {
              transform: `scale(${previous.width / width}, ${previous.height / height})`,
            },
            { transform: 'scale(1)' },
          ],
          { duration: 240, easing: 'cubic-bezier(.2,.75,.28,1)' },
        );
      }
      previous = { width, height };
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    const stopMotion = () => {
      if (reducedMotion.matches) motion?.cancel();
    };
    reducedMotion.addEventListener('change', stopMotion);
    return () => {
      motion?.cancel();
      observer.disconnect();
      reducedMotion.removeEventListener('change', stopMotion);
    };
  }, []);

  return (
    <svg
      ref={ref}
      className="kingdom-wall"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect className="kingdom-wall-crenels" x="8" y="8" />
      <rect className="kingdom-wall-masonry" x="8" y="8" />
      <rect className="kingdom-wall-edge" x="8" y="8" />
    </svg>
  );
}
