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

export function OutLink({ item }: { item: Source }) {
  return (
    <a className="source" href={item.url} target="_blank" rel="noreferrer">
      <span>
        {item.title}
        {item.status && <small>{item.status}</small>}
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
  className,
  children,
  close,
}: {
  title: string;
  titleHref?: string;
  showLinkIcon?: boolean;
  titleIcon?: ReactNode;
  headingActions?: ReactNode;
  className?: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
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
    ref.current?.showModal();
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
        <button className="icon-button" aria-label="닫기" onClick={close}>
          <X size={20} />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
