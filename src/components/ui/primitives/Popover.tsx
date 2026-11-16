import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx';

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  /** Ausrichtung relativ zum Anker. */
  align?: 'start' | 'end';
  className?: string;
  label: string;
  role?: 'dialog' | 'menu';
  /** Element, das beim Öffnen fokussiert wird (sonst das erste fokussierbare). */
  initialFocusRef?: RefObject<HTMLElement | null> | undefined;
}

const GAP = 8;
const MARGIN = 12;

/**
 * Leichtgewichtiges Popover: per Portal an <body>, fixed positioniert am Anker,
 * klappt nach oben, wenn unten kein Platz ist. Schließt bei Esc, Klick außerhalb
 * und gibt den Fokus an den Anker zurück.
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  children,
  align = 'start',
  className,
  label,
  role = 'dialog',
  initialFocusRef,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const el = ref.current;
    if (!anchor || !el) return;
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.scrollHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const below = vh - a.bottom - GAP - MARGIN;
    const above = a.top - GAP - MARGIN;
    const openUp = h > below && above > below;
    const maxHeight = Math.max(160, openUp ? above : below);
    const top = openUp ? Math.max(MARGIN, a.top - GAP - Math.min(h, maxHeight)) : a.bottom + GAP;
    let left = align === 'start' ? a.left : a.right - w;
    left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
    setPos({ top, left, maxHeight });
  }, [anchorRef, align]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const focusTarget =
      initialFocusRef?.current ??
      ref.current?.querySelector<HTMLElement>('input, button, [href], select, textarea, [tabindex]:not([tabindex="-1"])');
    focusTarget?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        anchor?.focus({ preventScroll: true });
      }
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (ref.current?.contains(t) || anchor?.contains(t))) return;
      onClose();
    };
    const onReflow = () => place();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, onClose, anchorRef, initialFocusRef, place]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={label}
      style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight } : { top: -9999, left: -9999 }}
      className={cx(
        'fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel-solid shadow-2xl shadow-black/60',
        'motion-safe:animate-pop-in',
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
