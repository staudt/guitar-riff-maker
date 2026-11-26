import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: ComponentChildren;
  testId?: string;
}

/**
 * Bottom sheet over a dimmed backdrop. Slides up, respects the bottom safe area.
 * Closes on backdrop tap and Escape. Focus moves into the sheet on open and returns on close.
 */
export function Sheet(props: SheetProps) {
  const { open, onClose, title, children, testId } = props;
  const panelRef = useRef<HTMLDivElement>(null);
  // Keep the latest callback without re-subscribing the key listener on every render.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      class="ui-sheet-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        class="ui-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-testid={testId}
      >
        {title ? <h2 class="ui-sheet__title">{title}</h2> : null}
        {children}
      </div>
    </div>
  );
}
