import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ExternalLink, X } from 'lucide-react';
import type { Source } from '../server/model.ts';

export const releaseTime = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  hour12: false,
  timeZone: 'Asia/Seoul',
});

export function OutLink({
  item,
  statusBadge,
}: {
  item: Source;
  statusBadge?: ReactNode;
}) {
  return (
    <a className="source" href={item.url} target="_blank" rel="noreferrer">
      <span>
        {item.title}
        {statusBadge ?? (item.status && <small>{item.status}</small>)}
      </span>
      <ExternalLink size={14} />
    </a>
  );
}

export function ResultLink({ item }: { item: Source }) {
  return (
    <a
      className="source result-link"
      title={item.title}
      href={item.url}
      target="_blank"
      rel="noreferrer"
    >
      <span>{item.title}</span>
      {item.status && <small>{item.status}</small>}
      <ExternalLink size={14} aria-hidden="true" />
    </a>
  );
}

export function Dialog({
  title,
  titleHref,
  showLinkIcon = true,
  titleIcon,
  headingActions,
  showCloseButton = true,
  className,
  children,
  close,
}: {
  title: string;
  titleHref?: string;
  showLinkIcon?: boolean;
  titleIcon?: ReactNode;
  headingActions?: ReactNode;
  showCloseButton?: boolean;
  className?: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pressedBackdrop = useRef<number | null>(null);
  const releasedBackdrop = useRef(false);

  function isBackdrop(event: {
    currentTarget: HTMLDialogElement;
    target: EventTarget;
    clientX: number;
    clientY: number;
  }) {
    const box = event.currentTarget.getBoundingClientRect();
    return (
      event.target === event.currentTarget &&
      (event.clientX < box.left ||
        event.clientX >= box.right ||
        event.clientY < box.top ||
        event.clientY >= box.bottom)
    );
  }

  useEffect(() => {
    const dialog = ref.current;
    const body = bodyRef.current;
    if (!dialog || !body) return;

    dialog.showModal();
    const viewport = window.visualViewport;
    if (!viewport) return;

    function clearViewport(dialog: HTMLDialogElement) {
      dialog.removeAttribute('data-constrained-viewport');
      dialog.style.removeProperty('--dialog-viewport-center');
      dialog.style.removeProperty('--dialog-viewport-height');
    }

    let frame = 0;
    function scheduleUpdate() {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const { height, offsetTop, scale } = viewport;
        const zoomed = Math.abs(scale - 1) > 0.01;
        // 키보드가 레이아웃 뷰포트까지 줄이면 기존 dvh 제한을 사용합니다.
        // 가시 영역만 줄어드는 경우에는 Safari의 위아래 이동도 반영합니다.
        if (!zoomed && height < document.documentElement.clientHeight - 1) {
          dialog.setAttribute('data-constrained-viewport', '');
          dialog.style.setProperty(
            '--dialog-viewport-center',
            `${offsetTop + height / 2}px`,
          );
          dialog.style.setProperty('--dialog-viewport-height', `${height}px`);
        } else {
          clearViewport(dialog);
        }

        const focused = document.activeElement;
        if (
          zoomed ||
          !(focused instanceof HTMLElement) ||
          !body.contains(focused) ||
          !focused.matches('input, textarea, [contenteditable="true"]')
        )
          return;

        // 페이지까지 스크롤시키지 않고 팝업 본문에서만 입력란을 드러냅니다.
        const field = focused.getBoundingClientRect();
        const visible = body.getBoundingClientRect();
        if (field.top < visible.top || field.height > visible.height) {
          body.scrollTop += field.top - visible.top;
        } else if (field.bottom > visible.bottom) {
          body.scrollTop += field.bottom - visible.bottom;
        }
      });
    }

    scheduleUpdate();
    viewport.addEventListener('resize', scheduleUpdate);
    viewport.addEventListener('scroll', scheduleUpdate);
    window.addEventListener('resize', scheduleUpdate);
    dialog.addEventListener('focusin', scheduleUpdate);
    return () => {
      window.cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', scheduleUpdate);
      viewport.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      dialog.removeEventListener('focusin', scheduleUpdate);
      clearViewport(dialog);
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={className ? `panel dialog ${className}` : 'panel dialog'}
      aria-label={title}
      onCancel={close}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        pressedBackdrop.current = isBackdrop(event) ? event.pointerId : null;
        releasedBackdrop.current = false;
      }}
      onPointerUp={(event) => {
        if (event.isPrimary)
          releasedBackdrop.current =
            pressedBackdrop.current === event.pointerId && isBackdrop(event);
      }}
      onPointerCancel={(event) => {
        if (event.isPrimary) {
          pressedBackdrop.current = null;
          releasedBackdrop.current = false;
        }
      }}
      onClick={(event) => {
        const dismiss = releasedBackdrop.current && isBackdrop(event);
        pressedBackdrop.current = null;
        releasedBackdrop.current = false;
        if (dismiss) close();
      }}
    >
      <div className="dialog-heading">
        <h2>
          {titleHref ? (
            <a
              className="dialog-title-link"
              href={titleHref}
              target="_blank"
              rel="noreferrer"
            >
              {titleIcon}
              {title}
              {showLinkIcon && <ExternalLink size={15} aria-hidden="true" />}
            </a>
          ) : (
            title
          )}
        </h2>
        {headingActions}
        {showCloseButton && (
          <button className="icon-button" aria-label="닫기" onClick={close}>
            <X size={20} />
          </button>
        )}
      </div>
      <div ref={bodyRef} className="dialog-body">
        {children}
      </div>
    </dialog>
  );
}
