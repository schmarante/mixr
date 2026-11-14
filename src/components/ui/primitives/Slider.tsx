import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { cx } from '../lib/cx';

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  /** Logarithmische Skala (z. B. Frequenzen). */
  log?: boolean | undefined;
  label: string;
  valueText?: string | undefined;
  /** coalesce=true während Ziehen/Tastenwiederholung → ein Undo-Schritt. */
  onChange: (value: number, coalesce: boolean) => void;
  /** Doppelklick setzt auf Standard zurück. */
  onReset?: (() => void) | undefined;
  /** Füllfarbe (Tailwind bg-Klasse). */
  fillClass?: string | undefined;
  size?: 'sm' | 'md';
  disabled?: boolean | undefined;
  className?: string | undefined;
}

function toPos(v: number, min: number, max: number, log: boolean): number {
  if (max <= min) return 0;
  if (log && min > 0) return Math.log(v / min) / Math.log(max / min);
  return (v - min) / (max - min);
}

function fromPos(p: number, min: number, max: number, log: boolean): number {
  const c = Math.min(1, Math.max(0, p));
  if (log && min > 0) return min * Math.pow(max / min, c);
  return min + c * (max - min);
}

function snap(v: number, min: number, max: number, step: number): number {
  const s = step > 0 ? Math.round((v - min) / step) * step + min : v;
  const decimals = step > 0 && step < 1 ? Math.min(4, String(step).split('.')[1]?.length ?? 2) : 0;
  return Number(Math.min(max, Math.max(min, s)).toFixed(decimals));
}

/**
 * Zugänglicher Slider (role="slider") mit großer Trefferfläche, Pointer-Drag,
 * Tastatur (Pfeile, Bild↑/↓, Pos1/Ende) und optionaler Log-Skala.
 */
export function Slider({
  value,
  min,
  max,
  step,
  log = false,
  label,
  valueText,
  onChange,
  onReset,
  fillClass = 'bg-accent',
  size = 'md',
  disabled,
  className,
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const pos = Math.min(1, Math.max(0, toPos(value, min, max, log)));

  const valueAt = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return value;
    return snap(fromPos((clientX - r.left) / r.width, min, max, log), min, max, step);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    e.currentTarget.focus({ preventScroll: true });
    const v = valueAt(e.clientX);
    if (v !== value) onChange(v, true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const v = valueAt(e.clientX);
    if (v !== value) onChange(v, true);
  };
  const endDrag = () => {
    dragging.current = false;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const big = e.key === 'PageUp' || e.key === 'PageDown' || e.shiftKey;
    let dir = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp') dir = 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown') dir = -1;
    let next: number | null = null;
    if (dir !== 0) {
      if (log && min > 0) {
        next = fromPos(pos + dir * (big ? 0.1 : 0.02), min, max, true);
      } else {
        next = value + dir * step * (big ? 10 : 1);
      }
    } else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    const v = snap(next, min, max, step);
    if (v === value && dir !== 0 && step > 0) {
      // Bei Log-Skala und grobem Raster: mindestens einen Schritt weiter
      onChange(snap(value + dir * step, min, max, step), true);
    } else if (v !== value) onChange(v, true);
  };

  const h = size === 'sm' ? 'h-6' : 'h-8';
  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      aria-disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      className={cx(
        'group/slider relative flex cursor-pointer touch-none select-none items-center rounded-full outline-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        disabled && 'cursor-default opacity-40',
        h,
        className,
      )}
    >
      <div ref={trackRef} className={cx('relative w-full rounded-full bg-raised', size === 'sm' ? 'h-1' : 'h-1.5')}>
        <div className={cx('absolute inset-y-0 left-0 rounded-full', fillClass)} style={{ width: `${pos * 100}%` }} />
        <div
          className={cx(
            'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-canvas bg-fg shadow-md shadow-black/40',
            'transition-transform duration-100 group-hover/slider:scale-110 group-active/slider:scale-110',
            size === 'sm' ? 'size-3' : 'size-4',
          )}
          style={{ left: `${pos * 100}%` }}
        />
      </div>
    </div>
  );
}
