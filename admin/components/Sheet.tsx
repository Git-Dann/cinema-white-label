'use client';

import { FormEvent, ReactNode, useEffect, useRef } from 'react';

/**
 * The one way the portal edits or adds things: a panel over the page (like Food & drink),
 * never a form pushed in above the list. Escape, the backdrop or Close dismiss it.
 * `footer` holds the actions; put Save first and anything destructive (Delete,
 * Deactivate) at the far end with `sheet-foot-end`.
 */
export function Sheet({
  open,
  title,
  subtitle,
  onClose,
  onSubmit,
  footer,
  narrow,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  onSubmit?: (e: FormEvent) => void;
  footer?: ReactNode;
  /** For short forms: a 560px panel instead of 880px. */
  narrow?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const id = `sheet-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <dialog
      ref={ref}
      className={narrow ? 'sheet sheet-narrow' : 'sheet'}
      aria-labelledby={id}
      onClose={onClose}
      onCancel={onClose}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose(); // a click on the backdrop
      }}
    >
      {open && (
        <form onSubmit={onSubmit ?? ((e) => e.preventDefault())} noValidate>
          <div className="sheet-head">
            <div>
              <h2 id={id} className="h3">{title}</h2>
              {subtitle && <p className="muted small sheet-sub">{subtitle}</p>}
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              Close
            </button>
          </div>
          {children}
          {footer && <div className="sheet-foot">{footer}</div>}
        </form>
      )}
    </dialog>
  );
}

/**
 * Makes a whole card the button that opens it. Put it first inside a `.tile-click` card;
 * anything else interactive in the card needs `className="tile-above"`.
 */
export function TileHit({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="tile-hit" aria-label={label} onClick={onClick} disabled={disabled} />;
}
