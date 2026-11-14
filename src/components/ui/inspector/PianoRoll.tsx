import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useT } from '../../../i18n/react';
import { cx } from '../lib/cx';
import { gridNotes, noteAt, stepsPerBeat, type GridNote, type NormalGrid } from '../lib/noteGrid';

export interface PianoRollRow {
  degree: number;
  label: string;
  emphasized: boolean;
}

interface PianoRollProps {
  grid: NormalGrid;
  /** Aktueller Stand für Ereignis-Handler (kann neuer sein als `grid` im Render). */
  getGrid: () => NormalGrid;
  rows: PianoRollRow[];
  /** Sichtbares Fenster: Spalten [from, from + cols). */
  from: number;
  cols: number;
  playhead: number | null;
  activeClass: string;
  label: string;
  onAdd: (degree: number, col: number) => void;
  onRemove: (note: GridNote) => void;
  /** Länge per Tastatur (sofort gespeichert). */
  onLength: (note: GridNote, len: number) => void;
  /** Länge per Ziehen: Vorschau während des Ziehens, `commit` beim Loslassen. */
  onResizePreview: (note: GridNote, len: number) => void;
  onResizeEnd: (commit: boolean) => void;
  /** Tastatur am Fensterrand: Fenster wechseln (−1/+1). Liefert true, wenn gewechselt wurde. */
  onEdge: (dir: -1 | 1) => boolean;
}

/**
 * Piano-Roll mit Haltetönen: Noten sind durchgehende Balken über ihre Dauer, rechts
 * mit Griff zum Verlängern/Kürzen (Maus & Touch). Zellen liegen als Bedienschicht
 * darüber (Klick: setzen/löschen, Ziehen: malen), der Griff ganz oben.
 * Tastatur: Pfeile bewegen, Enter/Leertaste setzt/löscht, Shift+←/→ ändert die Länge.
 */
export function PianoRoll({
  grid,
  getGrid,
  rows,
  from,
  cols,
  playhead,
  activeClass,
  label,
  onAdd,
  onRemove,
  onLength,
  onResizePreview,
  onResizeEnd,
  onEdge,
}: PianoRollProps) {
  const { t } = useT();
  const paint = useRef<'add' | 'remove' | null>(null);
  const resize = useRef<{ note: GridNote; el: HTMLElement } | null>(null);
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ r: number; c: number } | null>(null);

  useEffect(() => {
    const end = () => (paint.current = null);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);

  // Nach einem Fensterwechsel per Tastatur die Zielzelle fokussieren
  useEffect(() => {
    const p = pendingFocus.current;
    if (!p) return;
    pendingFocus.current = null;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-cell="${p.r}-${p.c}"]`)?.focus();
  }, [from]);

  const { steps, bars } = grid;
  const beat = stepsPerBeat(steps);
  const r0 = Math.min(focus.r, rows.length - 1);
  const c0 = Math.max(from, Math.min(focus.c, from + cols - 1));
  const windowBars = cols / steps;

  const focusCell = (r: number, c: number) => {
    const nr = Math.max(0, Math.min(rows.length - 1, r));
    if (c < from || c >= from + cols) {
      const dir = c < from ? -1 : 1;
      if (onEdge(dir)) {
        setFocus({ r: nr, c });
        pendingFocus.current = { r: nr, c };
      }
      return;
    }
    setFocus({ r: nr, c });
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-cell="${nr}-${c}"]`)?.focus();
  };

  const toggle = (degree: number, col: number) => {
    const hit = noteAt(getGrid(), degree, col);
    if (hit) onRemove(hit);
    else onAdd(degree, col);
  };

  const onCellDown = (e: PointerEvent<HTMLButtonElement>, r: number, col: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Touch: implizite Pointer-Capture freigeben, damit Malen über Zellen funktioniert
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const degree = rows[r]!.degree;
    const hit = noteAt(getGrid(), degree, col);
    paint.current = hit ? 'remove' : 'add';
    setFocus({ r, c: col });
    if (hit) onRemove(hit);
    else onAdd(degree, col);
  };

  const onCellEnter = (r: number, col: number) => {
    if (paint.current === null) return;
    const degree = rows[r]!.degree;
    const hit = noteAt(getGrid(), degree, col);
    // Malen in den Haltebereich derselben Stufe kürzt die gehaltene Note bis davor
    if (paint.current === 'add' && (!hit || hit.start !== col)) onAdd(degree, col);
    if (paint.current === 'remove' && hit) onRemove(hit);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, r: number, col: number) => {
    if (e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      e.stopPropagation();
      const hit = noteAt(getGrid(), rows[r]!.degree, col);
      if (hit) onLength(hit, hit.len + (e.key === 'ArrowRight' ? 1 : -1));
      return;
    }
    const moves: Record<string, [number, number]> = {
      ArrowUp: [r - 1, col],
      ArrowDown: [r + 1, col],
      ArrowLeft: [r, col - 1],
      ArrowRight: [r, col + 1],
      Home: [r, from],
      End: [r, from + cols - 1],
    };
    const m = moves[e.key];
    if (m && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      if (m[1] >= 0 && m[1] < grid.total) focusCell(m[0], m[1]);
    }
  };

  /* Griff ziehen */
  const onHandleDown = (e: PointerEvent<HTMLSpanElement>, note: GridNote) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const row = e.currentTarget.parentElement;
    if (!row) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    resize.current = { note, el: row };
  };
  const onHandleMove = (e: PointerEvent<HTMLSpanElement>) => {
    const r = resize.current;
    if (!r) return;
    const rect = r.el.getBoundingClientRect();
    const col = from + Math.floor(((e.clientX - rect.left) / rect.width) * cols);
    onResizePreview(r.note, col - r.note.start + 1);
  };
  const onHandleUp = (commit: boolean) => {
    if (!resize.current) return;
    resize.current = null;
    onResizeEnd(commit);
  };

  const position = (col: number) => {
    const bar = Math.floor(col / steps);
    const step = (col % steps) + 1;
    return bars > 1 ? t('ui.noteGrid.posBar', { bar: bar + 1, step }) : t('ui.noteGrid.posStep', { step });
  };

  const notes = gridNotes(grid).filter((n) => n.start < from + cols && n.start + n.len > from);
  const columns = Array.from({ length: cols }, (_, i) => from + i);
  const template = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` };

  return (
    <div ref={gridRef} role="group" aria-label={label} data-keep-space className="flex flex-col gap-1 select-none">
      {/* Taktnummern (nur wenn mehrere Takte sichtbar sind) */}
      {windowBars > 1 && (
        <div className="flex items-end gap-2" aria-hidden="true">
          <div className="w-12 shrink-0" />
          <div className="grid flex-1 gap-1" style={template}>
            {Array.from({ length: windowBars }, (_, b) => (
              <span
                key={b}
                className="truncate border-l-2 border-line-strong pl-1.5 text-[10px] font-semibold tracking-wide text-muted uppercase"
                style={{ gridColumn: `${b * steps + 1} / span ${steps}` }}
              >
                {t('ui.noteGrid.barLabel', { bar: from / steps + b + 1 })}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Schlagzahlen */}
      <div className="flex items-end gap-2" aria-hidden="true">
        <div className="w-12 shrink-0" />
        <div className="grid flex-1 gap-1" style={template}>
          {columns.map((col) => {
            const s = col % steps;
            const onBeat = s % beat === 0;
            return (
              <span
                key={col}
                className={cx(
                  'flex h-4 items-center justify-center rounded text-[10px] tabular-nums transition-colors',
                  playhead === col ? 'bg-fg/90 font-bold text-canvas' : onBeat ? 'font-semibold text-muted' : 'text-faint/60',
                )}
              >
                {onBeat ? s / beat + 1 : '·'}
              </span>
            );
          })}
        </div>
      </div>

      {rows.map((row, r) => (
        <div key={row.degree} className={cx('flex items-center gap-2 rounded-lg', row.emphasized && 'bg-white/[0.035]')}>
          <div
            className={cx('w-12 shrink-0 truncate pl-1.5 text-right text-xs', row.emphasized ? 'font-semibold text-fg' : 'text-muted')}
            title={row.label}
          >
            {row.label}
          </div>
          <div className="relative grid flex-1 gap-1" style={template}>
            {/* Notenbalken (rein visuell) */}
            {notes
              .filter((n) => n.degree === row.degree)
              .map((n) => {
                const vs = Math.max(n.start, from);
                const ve = Math.min(n.start + n.len, from + cols);
                const playing = playhead !== null && playhead >= n.start && playhead < n.start + n.len;
                return (
                  <span
                    key={`n${n.start}`}
                    aria-hidden="true"
                    className={cx(
                      'pointer-events-none z-0 h-8 rounded-md shadow-[inset_0_0_0_1px_rgb(0_0_0/0.18)] transition-[filter] duration-75',
                      activeClass,
                      n.start < from && 'rounded-l-none',
                      n.start + n.len > from + cols && 'rounded-r-none',
                      playing && 'brightness-125',
                    )}
                    style={{ gridRow: 1, gridColumn: `${vs - from + 1} / span ${ve - vs}` }}
                  >
                    {n.len > 1 && n.start >= from && (
                      // Kennzeichnet den Notenanfang innerhalb des Balkens
                      <span className="ml-1 inline-block h-full w-1 rounded-full bg-black/15" />
                    )}
                  </span>
                );
              })}

            {/* Zellen (Bedienschicht) */}
            {columns.map((col) => {
              const s = col % steps;
              const hit = noteAt(grid, row.degree, col);
              const head = playhead === col;
              const altBeat = Math.floor(s / beat) % 2 === 1;
              const barStart = s === 0 && col !== from;
              const name = `${row.label}, ${position(col)}`;
              const aria = !hit
                ? name
                : hit.start === col
                  ? t('ui.noteGrid.cellNote', { name, count: hit.len })
                  : t('ui.noteGrid.cellHeld', { name, start: position(hit.start) });
              return (
                <button
                  key={col}
                  type="button"
                  data-cell={`${r}-${col}`}
                  tabIndex={r === r0 && col === c0 ? 0 : -1}
                  aria-pressed={hit !== null}
                  aria-label={aria}
                  onPointerDown={(e) => onCellDown(e, r, col)}
                  onPointerEnter={() => onCellEnter(r, col)}
                  onClick={(e) => {
                    // Nur Tastatur-Klicks (detail 0) – Maus/Touch laufen über pointerdown
                    if (e.detail === 0) toggle(row.degree, col);
                  }}
                  onKeyDown={(e) => onKeyDown(e, r, col)}
                  style={{ gridRow: 1, gridColumn: col - from + 1 }}
                  className={cx(
                    'relative z-10 h-8 min-w-0 touch-none rounded-md transition-[background-color,box-shadow] duration-75 focus-visible:outline-offset-1',
                    hit
                      ? cx('bg-transparent hover:bg-white/12', head && 'ring-2 ring-fg/80')
                      : head
                        ? 'bg-hover ring-1 ring-fg/30'
                        : altBeat
                          ? 'bg-cell-alt ring-1 ring-white/[0.04] ring-inset hover:bg-hover'
                          : 'bg-cell ring-1 ring-white/[0.05] ring-inset hover:bg-hover',
                    barStart && !hit && 'shadow-[-3px_0_0_0_rgb(255_255_255/0.16)]',
                  )}
                />
              );
            })}

            {/* Griffe zum Verlängern (nur wenn das Notenende sichtbar ist) */}
            {notes
              .filter((n) => n.degree === row.degree && n.start + n.len <= from + cols)
              .map((n) => (
                <span
                  key={`h${n.start}`}
                  aria-hidden="true"
                  title={t('ui.noteGrid.resize')}
                  onPointerDown={(e) => onHandleDown(e, n)}
                  onPointerMove={onHandleMove}
                  onPointerUp={() => onHandleUp(true)}
                  onPointerCancel={() => onHandleUp(false)}
                  onLostPointerCapture={() => onHandleUp(true)}
                  className="z-20 flex h-8 w-3.5 cursor-ew-resize touch-none items-center justify-center gap-[2px] justify-self-end rounded-r-md hover:bg-black/15"
                  style={{ gridRow: 1, gridColumn: n.start + n.len - from }}
                >
                  <span className="h-3.5 w-px rounded-full bg-black/45" />
                  <span className="h-3.5 w-px rounded-full bg-black/45" />
                </span>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
