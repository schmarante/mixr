import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { stepsPerBeat } from '../lib/noteGrid';

export interface StepGridRow {
  key: string;
  label: string;
  /** Hervorgehobene Zeile (z. B. Grundton). */
  emphasized?: boolean;
}

interface StepGridProps {
  rows: StepGridRow[];
  steps: number;
  isOn: (row: number, step: number) => boolean;
  /** Setzt eine Zelle; muss idempotent sein (wird beim Malen mehrfach gerufen). */
  onSet: (row: number, step: number, on: boolean) => void;
  playhead: number | null;
  activeClass: string;
  label: string;
  cellLabel: (row: number, step: number) => string;
  /** Zeilen-Label-Spalte breiter/schmaler. */
  labelWidth?: string;
}

/**
 * Generisches Step-Raster (Drum-Sequencer & Piano-Roll):
 * Klicken + Ziehen malt/löscht, 4er-Gruppen optisch getrennt, Lauflicht,
 * Tastatur mit Roving-Tabindex (Pfeiltasten, Leertaste/Enter schaltet).
 */
export function StepGrid({ rows, steps, isOn, onSet, playhead, activeClass, label, cellLabel, labelWidth = 'w-20' }: StepGridProps) {
  const paint = useRef<boolean | null>(null);
  const [focus, setFocus] = useState<{ r: number; s: number }>({ r: 0, s: 0 });
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const end = () => (paint.current = null);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);

  const r0 = Math.min(focus.r, rows.length - 1);
  const s0 = Math.min(focus.s, steps - 1);

  const focusCell = (r: number, s: number) => {
    const nr = Math.max(0, Math.min(rows.length - 1, r));
    const ns = Math.max(0, Math.min(steps - 1, s));
    setFocus({ r: nr, s: ns });
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-cell="${nr}-${ns}"]`)?.focus();
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, r: number, s: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Bei Touch hält der Browser implizit die Pointer-Capture – freigeben, damit Malen über Zellen funktioniert
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const mode = !isOn(r, s);
    paint.current = mode;
    setFocus({ r, s });
    onSet(r, s, mode);
  };

  const onPointerEnter = (r: number, s: number) => {
    if (paint.current !== null) onSet(r, s, paint.current);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, r: number, s: number) => {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [r - 1, s],
      ArrowDown: [r + 1, s],
      ArrowLeft: [r, s - 1],
      ArrowRight: [r, s + 1],
      Home: [r, 0],
      End: [r, steps - 1],
    };
    const m = moves[e.key];
    if (m && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      focusCell(m[0], m[1]);
    }
  };

  // Gruppen = Schläge (16 → 4er, 12 → 3er, 8 → 2er); ohne ganzzahligen Schlag keine Gruppen
  const beat = stepsPerBeat(steps);
  const groups = Math.ceil(steps / beat);
  const groupOf = (count: number, fn: (s: number) => ReactNode) =>
    Array.from({ length: groups }, (_, g) => (
      <div key={g} className="flex flex-1 gap-1">
        {Array.from({ length: Math.min(beat, count - g * beat) }, (_, k) => fn(g * beat + k))}
      </div>
    ));

  return (
    <div>
      <div ref={gridRef} role="group" aria-label={label} data-keep-space className="flex flex-col gap-1 select-none">
        {/* Kopfzeile mit Schlagzahlen */}
        <div className="flex items-end gap-2" aria-hidden="true">
          <div className={cx('shrink-0', labelWidth)} />
          <div className="flex flex-1 gap-2.5">
            {groupOf(steps, (s) => (
              <span
                key={s}
                className={cx(
                  'flex h-4 flex-1 items-center justify-center rounded text-[10px] tabular-nums transition-colors',
                  playhead === s ? 'bg-fg/90 font-bold text-canvas' : s % beat === 0 ? 'font-semibold text-muted' : 'text-faint/60',
                )}
              >
                {s % beat === 0 ? s / beat + 1 : '·'}
              </span>
            ))}
          </div>
        </div>

        {rows.map((row, r) => (
          <div
            key={row.key}
            className={cx('flex items-center gap-2 rounded-lg', row.emphasized && 'bg-white/[0.035]')}
          >
            <div
              className={cx(
                'shrink-0 truncate pl-1.5 text-right text-xs',
                labelWidth,
                row.emphasized ? 'font-semibold text-fg' : 'text-muted',
              )}
              title={row.label}
            >
              {row.label}
            </div>
            <div className="flex flex-1 gap-2.5">
              {groupOf(steps, (s) => {
                const on = isOn(r, s);
                const head = playhead === s;
                const altGroup = Math.floor(s / beat) % 2 === 1;
                return (
                  <button
                    key={s}
                    type="button"
                    data-cell={`${r}-${s}`}
                    tabIndex={r === r0 && s === s0 ? 0 : -1}
                    aria-pressed={on}
                    aria-label={cellLabel(r, s)}
                    onPointerDown={(e) => onPointerDown(e, r, s)}
                    onPointerEnter={() => onPointerEnter(r, s)}
                    onClick={(e) => {
                      // Nur Tastatur-Klicks (detail 0) – Maus/Touch laufen über pointerdown
                      if (e.detail === 0) onSet(r, s, !on);
                    }}
                    onKeyDown={(e) => onKeyDown(e, r, s)}
                    className={cx(
                      // Lauflicht ohne Größenänderung (ring = box-shadow): eine skalierte Zelle am Rand
                      // würde kurz überlaufen und im scrollenden Panel einen Scrollbalken/Sprung auslösen
                      'h-8 min-w-0 flex-1 touch-none rounded-md transition-[background-color,box-shadow] duration-75',
                      'focus-visible:outline-offset-1',
                      on
                        ? cx(activeClass, head && 'ring-2 ring-fg/80 brightness-125')
                        : head
                          ? 'bg-hover ring-1 ring-fg/30'
                          : altGroup
                            ? 'bg-cell-alt ring-1 ring-white/[0.04] ring-inset hover:bg-hover'
                            : 'bg-cell ring-1 ring-white/[0.05] ring-inset hover:bg-hover',
                    )}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
