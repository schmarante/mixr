import type { MouseEvent, ReactNode, Ref } from 'react';
import { cx } from '../lib/cx';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

const SIDE_CLASSES: Record<TooltipSide, string> = {
  top: 'bottom-full left-1/2 mb-2 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-2 -translate-x-1/2',
  left: 'right-full top-1/2 mr-2 -translate-y-1/2',
  right: 'left-full top-1/2 ml-2 -translate-y-1/2',
};

/** Tooltip, der bei Hover und bei Tastatur-Fokus des vorherigen Geschwister-Elements erscheint. */
export function PeerTooltip({ text, kbd, side = 'bottom' }: { text: string; kbd?: string | undefined; side?: TooltipSide }) {
  return (
    <span
      role="presentation"
      className={cx(
        'pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-line-strong bg-raised-solid px-2 py-1 text-xs font-medium text-fg shadow-lg shadow-black/40',
        // scale-0 im Ruhezustand: unsichtbare Tooltips erzeugen so keinen Scroll-Overflow
        'scale-0 opacity-0 transition-opacity duration-150 peer-hover:scale-100 peer-hover:opacity-100 peer-hover:delay-300 peer-focus-visible:scale-100 peer-focus-visible:opacity-100',
        SIDE_CLASSES[side],
      )}
    >
      {text}
      {kbd && <kbd className="ml-1.5 rounded border border-line-strong px-1 font-sans text-[10px] text-muted">{kbd}</kbd>}
    </span>
  );
}

type Variant = 'ghost' | 'subtle' | 'danger' | 'toggle';
type Size = 'xs' | 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  ghost: 'text-muted hover:bg-hover hover:text-fg',
  subtle: 'bg-card text-muted ring-1 ring-line hover:bg-hover hover:text-fg',
  danger: 'text-muted hover:bg-danger-soft hover:text-danger',
  toggle: 'text-muted hover:bg-hover hover:text-fg aria-pressed:bg-accent-soft aria-pressed:text-accent',
};

const SIZES: Record<Size, string> = {
  xs: 'size-6 rounded-md',
  sm: 'size-8 rounded-lg',
  md: 'size-10 rounded-xl',
};

export interface IconButtonProps {
  label: string;
  children: ReactNode;
  onClick?: ((e: MouseEvent<HTMLButtonElement>) => void) | undefined;
  variant?: Variant;
  size?: Size;
  pressed?: boolean | undefined;
  disabled?: boolean | undefined;
  tooltip?: TooltipSide | false;
  kbd?: string | undefined;
  className?: string | undefined;
  buttonRef?: Ref<HTMLButtonElement> | undefined;
  expanded?: boolean | undefined;
  hasPopup?: 'menu' | 'dialog' | 'listbox' | undefined;
}

/** Icon-Button mit aria-label und Tooltip (Hover + Tastaturfokus). */
export function IconButton({
  label,
  children,
  onClick,
  variant = 'ghost',
  size = 'sm',
  pressed,
  disabled,
  tooltip = 'bottom',
  kbd,
  className,
  buttonRef,
  expanded,
  hasPopup,
}: IconButtonProps) {
  return (
    <span className={cx('relative inline-flex shrink-0', className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        aria-expanded={expanded}
        aria-haspopup={hasPopup}
        disabled={disabled}
        onClick={onClick}
        className={cx(
          'peer inline-flex items-center justify-center transition-colors duration-150 disabled:pointer-events-none disabled:opacity-35',
          VARIANTS[variant],
          SIZES[size],
        )}
      >
        {children}
      </button>
      {tooltip !== false && <PeerTooltip text={label} kbd={kbd} side={tooltip} />}
    </span>
  );
}
