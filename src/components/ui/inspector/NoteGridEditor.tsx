import { useStore } from '@nanostores/react';
import { atom } from 'nanostores';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { paramHint, paramLabel } from '../../../blocks/text';
import { useT } from '../../../i18n/react';
import { NOTE_GRID_BARS, type BlockNode, type NoteGridParamDef, type NoteGridValue } from '../../../types/ast';
import { useSourcePlayhead } from '../hooks/usePlayhead';
import { cx } from '../lib/cx';
import { showToast } from '../lib/importFlow';
import {
  addNote,
  clearGrid,
  gridNotes,
  normalizeGrid,
  notesInBar,
  removeNote,
  repeatFirstBar,
  setBars,
  setNoteLength,
  toValue,
  type GridNote,
  type NormalGrid,
} from '../lib/noteGrid';
import { degreeName, isRootDegree, scaleLength } from '../lib/scales';
import type { TrackColorClasses } from '../lib/trackColors';
import { Switch } from '../primitives/Controls';
import { IconButton } from '../primitives/IconButton';
import { ChevronDownIcon, ChevronRightIcon, DuplicateIcon } from '../primitives/Icons';
import type { ParamChange } from './fields';
import { GridToolbar } from './GridToolbar';
import { PianoRoll, type PianoRollRow } from './PianoRoll';

/** Lauflicht folgen (Takt automatisch wechseln) – gilt für alle Melodien, Standard an. */
const followPlayback = atom(true);

/** Ab lg passen 32 Spalten gut, darunter 16. */
const wideQuery = '(min-width: 1024px)';
function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(wideQuery);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(wideQuery).matches,
    () => true,
  );
}

/** Wie viele Takte gleichzeitig sichtbar sind (Zweierpotenz, ≤ Spaltenbudget). */
function barsPerView(steps: number, bars: number, budget: number): number {
  let p = 1;
  while (p * 2 <= bars && p * 2 * steps <= budget) p *= 2;
  return p;
}

/**
 * Melodie-Editor: Piano-Roll in Skalenstufen mit Haltetönen und bis zu 16 Takten.
 * Oben hoch, unten tief, Grundton-Zeilen hervorgehoben; mehrere Töne in einer
 * Spalte ergeben einen Akkord (jeder mit eigener Länge).
 */
export function NoteGridEditor({
  def,
  value,
  block,
  onChange,
  color,
}: {
  def: NoteGridParamDef;
  value: NoteGridValue;
  block: BlockNode;
  onChange: ParamChange;
  color: TrackColorClasses;
}) {
  const { t } = useT();
  const label = paramLabel(block.type, def.key);
  const stored = useMemo(() => normalizeGrid(value), [value]);
  const [preview, setPreview] = useState<NormalGrid | null>(null);
  const grid = preview ?? stored;
  const latest = useRef(grid);
  latest.current = grid;
  const { steps, bars, total } = grid;

  const follow = useStore(followPlayback);
  const playhead = useSourcePlayhead(block.id, steps, bars);
  const wide = useWide();
  const viewBars = barsPerView(steps, bars, wide ? 32 : 16);
  const pages = bars / viewBars;
  const [page, setPage] = useState(0);
  const current = Math.min(page, pages - 1);
  const from = current * viewBars * steps;
  const cols = viewBars * steps;

  // Lauflicht folgen: Ansicht springt in den gerade spielenden Takt
  const playingPage = playhead === null ? null : Math.floor(playhead / cols);
  useEffect(() => {
    if (follow && playingPage !== null && playingPage !== current) setPage(playingPage);
  }, [follow, playingPage, current]);

  const root = typeof block.params['root'] === 'string' ? block.params['root'] : 'C';
  const scale = typeof block.params['scale'] === 'string' ? block.params['scale'] : 'minor';
  const octave = Number.parseInt(typeof block.params['octave'] === 'string' ? block.params['octave'] : '3', 10) || 3;

  /*
   * Sichtbare Tonstufen: kompakt eine Oktave (Grundton bis Grundton, z. B. 8 Zeilen),
   * automatisch so gelegt bzw. erweitert, dass alle Noten sichtbar sind. Oktave höher/
   * tiefer verschiebt das Fenster, „2 Oktaven“ zeigt den ganzen Bereich.
   */
  const octave1 = scaleLength(scale);
  const used = grid.cells.flat();
  const minN = used.length ? Math.min(...used) : 0;
  const maxN = used.length ? Math.max(...used) : 0;
  const lowest = Math.min(0, minN);
  const highest = Math.max(def.degrees - 1, maxN);
  const span = octave1 + 1;
  const [allOctaves, setAllOctaves] = useState(false);
  const [manualLo, setManualLo] = useState<number | null>(null);
  const autoLo = (() => {
    if (used.length === 0) return 0;
    let lo = Math.floor(minN / octave1) * octave1;
    if (maxN > lo + span - 1) lo = maxN - span + 1;
    return Math.max(lowest, Math.min(lo, highest - span + 1));
  })();
  const compactFits = maxN - minN < span;
  const full = allOctaves || highest - lowest + 1 <= span;
  let lo: number;
  let hi: number;
  if (full) [lo, hi] = [lowest, highest];
  else if (manualLo !== null) [lo, hi] = [manualLo, manualLo + span - 1];
  else if (compactFits) [lo, hi] = [autoLo, autoLo + span - 1];
  else [lo, hi] = [minN, maxN];
  const hiddenAbove = used.filter((d) => d > hi).length;
  const hiddenBelow = used.filter((d) => d < lo).length;
  const shiftOctave = (dir: -1 | 1) => {
    const next = Math.max(lowest, Math.min(lo + dir * octave1, highest - span + 1));
    setManualLo(next);
  };

  const rows: PianoRollRow[] = useMemo(() => {
    const list: PianoRollRow[] = [];
    for (let d = hi; d >= lo; d--) list.push({ degree: d, label: degreeName(d, root, scale, octave), emphasized: isRootDegree(d, scale) });
    return list;
  }, [lo, hi, root, scale, octave]);

  const notes = gridNotes(grid);

  /* Änderungen */
  const commit = (next: NormalGrid, coalesce: boolean) => {
    if (next === latest.current) return;
    // Fenster festhalten, sobald bearbeitet wird – sonst rutschen die Zeilen beim Malen weg
    if (!full && manualLo === null) setManualLo(lo);
    latest.current = next;
    onChange(toValue(next), coalesce);
  };

  const changeBars = (b: number) => {
    const { grid: next, removed } = setBars(latest.current, b);
    commit(next, false);
    if (removed > 0) showToast(t('ui.noteGrid.barsRemoved', { count: removed }), { undo: true });
  };

  const emptyBars = Array.from({ length: bars }, (_, b) => notesInBar(grid, b) === 0);
  const canRepeat = bars > 1 && !emptyBars[0] && emptyBars.some(Boolean);

  /* Übersicht: welche Spalten klingen? */
  const covered = useMemo(() => {
    const c = new Array<boolean>(total).fill(false);
    for (const n of notes) for (let i = n.start; i < n.start + n.len && i < total; i++) c[i] = true;
    return c;
  }, [notes, total]);

  const playingBar = playhead === null ? null : Math.floor(playhead / steps);
  const firstBar = current * viewBars + 1;
  const lastBar = firstBar + viewBars - 1;

  return (
    <div className="flex flex-col gap-3">
      <GridToolbar
        title={label}
        hint={paramHint(block.type, def.key) ?? t('ui.grid.noteHint')}
        onClear={notes.length > 0 ? () => commit(clearGrid(latest.current), false) : undefined}
      />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
        <fieldset className="flex items-center gap-2.5">
          <legend className="sr-only">{t('ui.noteGrid.length')}</legend>
          <span className="text-sm text-muted" aria-hidden="true">
            {t('ui.noteGrid.length')}
          </span>
          <span className="flex gap-1 rounded-xl bg-canvas p-1 ring-1 ring-line">
            {NOTE_GRID_BARS.map((b) => (
              <label
                key={b}
                title={t('ui.noteGrid.barsOption', { count: b })}
                className={cx(
                  'relative flex h-7 min-w-9 cursor-pointer items-center justify-center rounded-lg px-2 text-sm tabular-nums transition-colors',
                  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent',
                  b === bars ? 'bg-raised font-medium text-fg shadow-sm shadow-black/30' : 'text-muted hover:text-fg',
                )}
              >
                <input
                  type="radio"
                  name={`${block.id}-bars`}
                  value={b}
                  checked={b === bars}
                  onChange={() => changeBars(b)}
                  aria-label={t('ui.noteGrid.barsOption', { count: b })}
                  className="sr-only"
                />
                {b}
              </label>
            ))}
          </span>
          <span className="text-sm text-muted" aria-hidden="true">
            {t('ui.noteGrid.barsUnit', { count: bars })}
          </span>
        </fieldset>

        {pages > 1 && (
          <div className="flex items-center gap-1" role="group" aria-label={t('ui.noteGrid.navigation')}>
            <IconButton label={t('ui.noteGrid.prev')} size="sm" disabled={current === 0} onClick={() => { followPlayback.set(false); setPage(current - 1); }}>
              <ChevronDownIcon className="rotate-90" />
            </IconButton>
            <span className="min-w-24 text-center text-sm text-fg tabular-nums" aria-live="polite">
              {viewBars === 1
                ? t('ui.noteGrid.barOf', { bar: firstBar, total: bars })
                : t('ui.noteGrid.barsOf', { from: firstBar, to: lastBar, total: bars })}
            </span>
            <IconButton label={t('ui.noteGrid.next')} size="sm" disabled={current >= pages - 1} onClick={() => { followPlayback.set(false); setPage(current + 1); }}>
              <ChevronRightIcon />
            </IconButton>
          </div>
        )}

        {pages > 1 && (
          <Switch checked={follow} onChange={(v) => followPlayback.set(v)} label={t('ui.noteGrid.follow')}>
            <span className="text-muted">{t('ui.noteGrid.follow')}</span>
          </Switch>
        )}

        {canRepeat && (
          <button
            type="button"
            onClick={() => commit(repeatFirstBar(latest.current), false)}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted transition-colors hover:bg-hover hover:text-fg"
          >
            <DuplicateIcon size={15} />
            {t('ui.noteGrid.repeatFirst')}
          </button>
        )}
      </div>

      {highest - lowest + 1 > span && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('ui.noteGrid.range')}>
          <span className="mr-1 text-sm text-muted">{t('ui.noteGrid.range')}</span>
          {!full && (
            <>
              <button
                type="button"
                onClick={() => shiftOctave(1)}
                disabled={hi >= highest}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-card px-2.5 text-sm text-fg ring-1 ring-line transition-colors hover:bg-raised disabled:opacity-40"
              >
                <ChevronDownIcon size={15} className="rotate-180" />
                {t('ui.noteGrid.octaveUp')}
                {hiddenAbove > 0 && <span className="rounded-full bg-accent-soft px-1.5 text-xs text-accent">{t('ui.noteGrid.hiddenNotes', { count: hiddenAbove })}</span>}
              </button>
              <button
                type="button"
                onClick={() => shiftOctave(-1)}
                disabled={lo <= lowest}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-card px-2.5 text-sm text-fg ring-1 ring-line transition-colors hover:bg-raised disabled:opacity-40"
              >
                <ChevronDownIcon size={15} />
                {t('ui.noteGrid.octaveDown')}
                {hiddenBelow > 0 && <span className="rounded-full bg-accent-soft px-1.5 text-xs text-accent">{t('ui.noteGrid.hiddenNotes', { count: hiddenBelow })}</span>}
              </button>
            </>
          )}
          <Switch checked={allOctaves} onChange={setAllOctaves} label={t('ui.noteGrid.allOctaves')}>
            <span className="text-muted">{t('ui.noteGrid.allOctaves')}</span>
          </Switch>
        </div>
      )}

      {/* Übersicht aller Takte – Klick springt */}
      {bars > 1 && (
        <div className="flex gap-1" role="group" aria-label={t('ui.noteGrid.overview')}>
          {Array.from({ length: bars }, (_, b) => {
            const visible = b + 1 >= firstBar && b + 1 <= lastBar;
            const count = notesInBar(grid, b);
            return (
              <button
                key={b}
                type="button"
                aria-current={visible ? 'true' : undefined}
                aria-label={t('ui.noteGrid.overviewBar', { bar: b + 1, count })}
                title={t('ui.noteGrid.overviewBar', { bar: b + 1, count })}
                onClick={() => {
                  followPlayback.set(false);
                  setPage(Math.floor(b / viewBars));
                }}
                className={cx(
                  'relative flex h-6 min-w-0 flex-1 items-center gap-px overflow-hidden rounded-md px-1 ring-1 transition-colors',
                  visible ? 'bg-raised ring-accent/60' : 'bg-cell ring-line hover:bg-hover',
                )}
              >
                {Array.from({ length: steps }, (_, s) => (
                  <span
                    key={s}
                    className={cx('h-2.5 min-w-0 flex-1 rounded-[1px]', covered[b * steps + s] ? color.solid : 'bg-white/[0.06]')}
                  />
                ))}
                {playingBar === b && <span className="absolute inset-x-1 bottom-0.5 h-0.5 rounded-full bg-fg/80" />}
              </button>
            );
          })}
        </div>
      )}

      <PianoRoll
        grid={grid}
        getGrid={() => latest.current}
        rows={rows}
        from={from}
        cols={cols}
        playhead={playhead}
        activeClass={color.solid}
        label={t('ui.grid.noteLabel', { label })}
        onAdd={(degree, col) => commit(addNote(latest.current, degree, col), true)}
        onRemove={(n: GridNote) => commit(removeNote(latest.current, n.degree, n.start), true)}
        onLength={(n, len) => commit(setNoteLength(latest.current, n.degree, n.start, len), false)}
        // Vorschau immer vom gespeicherten Stand aus – Hin- und Herziehen bleibt sauber, ein Undo-Schritt beim Loslassen
        onResizePreview={(n, len) => setPreview(setNoteLength(stored, n.degree, n.start, len))}
        onResizeEnd={(ok) => {
          const p = preview;
          setPreview(null);
          if (ok && p) {
            latest.current = stored;
            commit(p, false);
          }
        }}
        onEdge={(dir) => {
          const target = current + dir;
          if (target < 0 || target >= pages) return false;
          followPlayback.set(false);
          setPage(target);
          return true;
        }}
      />
    </div>
  );
}
