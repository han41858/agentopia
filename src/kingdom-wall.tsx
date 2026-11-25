import { useId, useLayoutEffect, useRef } from 'react';

export function KingdomWall() {
  const ref = useRef<SVGSVGElement>(null);
  const outline = useRef<SVGPathElement>(null);
  const shapeId = useId();
  const exteriorMask = useId();

  useLayoutEffect(() => {
    const wall = ref.current;
    const area = wall?.parentElement;
    if (!wall || !area) return;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let previous:
      { width: number; height: number; archDepth: number } | undefined;
    let motion: Animation | undefined;

    function measure() {
      if (!wall || !area) return;
      const width = area.offsetWidth;
      const height = area.offsetHeight;
      const archDepth =
        Number.parseFloat(
          getComputedStyle(area).getPropertyValue('--kingdom-arch-depth'),
        ) || 104;
      if (
        !width ||
        !height ||
        (previous?.width === width &&
          previous.height === height &&
          previous.archDepth === archDepth)
      )
        return;
      const insideWidth = Math.max(1, width - 16);
      const insideHeight = Math.max(1, height - 16);
      wall.setAttribute('viewBox', `0 0 ${width} ${height}`);
      const rx = insideWidth * 0.48;
      const ry = Math.min(insideHeight * 0.48, archDepth);
      const right = 8 + insideWidth;
      const bottom = 8 + insideHeight;
      outline.current?.setAttribute(
        'd',
        [
          `M8 ${bottom} V${8 + ry}`,
          `A${rx} ${ry} 0 0 1 ${8 + rx} 8 H${right - rx}`,
          `A${rx} ${ry} 0 0 1 ${right} ${8 + ry}`,
          `V${bottom} H8 Z`,
        ].join(' '),
      );
      motion?.cancel();
      if (
        previous &&
        !reducedMotion.matches &&
        !wall.closest('[data-display-mode="simple"]') &&
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
      previous = { width, height, archDepth };
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
      <defs>
        <path ref={outline} id={shapeId} />
        <mask
          id={exteriorMask}
          x="0"
          y="0"
          width="100%"
          height="100%"
          maskUnits="userSpaceOnUse"
        >
          <rect width="100%" height="100%" fill="white" />
          <use href={`#${shapeId}`} fill="black" />
        </mask>
      </defs>
      <use
        href={`#${shapeId}`}
        className="kingdom-wall-crenels"
        mask={`url(#${exteriorMask})`}
      />
      <use href={`#${shapeId}`} className="kingdom-wall-masonry" />
      <use href={`#${shapeId}`} className="kingdom-wall-edge" />
    </svg>
  );
}
