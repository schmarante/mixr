import { useT } from '../../../i18n/react';
import type { BlockNode } from '../../../types/ast';
import { cx } from '../lib/cx';
import { gridNotes, normalizeGrid, stepsPerBeat, type GridNote, type NormalGrid } from '../lib/noteGrid';
import { isDrumGridValue, isNoteGridValue } from '../lib/params';
import { useSourcePlayhead } from '../hooks/usePlayhead';

/** Winzige Vorschau einer Klangquelle (Raster, Notenbild oder Text). */
export function MiniPreview({ block, activeClass }: { block: BlockNode; activeClass: string }) {
  const { t } = useT();
  const p = block.params;

  if (block.type === 'drums' && isDrumGridValue(p['grid'])) {
    const grid = p['grid'];
    const rows = Object.values(grid.rows).filter((r) => r.some(Boolean)).slice(0, 4);
    if (rows.length === 0) return <MiniText text={t('ui.workspace.emptyPreview')} muted />;
    return (
      <DrumPreview blockId={block.id} steps={grid.steps} rows={rows.map((r) => Array.from({ length: grid.steps }, (_, i) => r[i] === true))} activeClass={activeClass} />
    );
  }

  if (block.type === 'melody' && isNoteGridValue(p['grid'])) {
    const grid = normalizeGrid(p['grid']);
    const notes = gridNotes(grid);
    if (notes.length === 0) return <MiniText text={t('ui.workspace.emptyPreview')} muted />;
    return <MelodyPreview blockId={block.id} grid={grid} notes={notes} activeClass={activeClass} />;
  }

  if (block.type === 'chords') {
    const custom = typeof p['custom'] === 'string' ? p['custom'].trim() : '';
    const prog = custom || (typeof p['progression'] === 'string' ? p['progression'] : '');
    const chords = prog.replace(/[<>]/g, '').trim().split(/\s+/).filter(Boolean);
    // Einfache Folge „<Am F C G>“ = ein Akkord pro Takt → aktuellen hervorheben
    const simple = /^<[^<>[\]{}()*/!@?|,.]+>$/.test(prog.trim());
    return simple && chords.length > 0 ? <ChordsPreview blockId={block.id} chords={chords} /> : <MiniText text={chords.join(' · ')} />;
  }

  const text = typeof p['pattern'] === 'string' ? p['pattern'] : typeof p['code'] === 'string' ? p['code'] : '';
  return <MiniText text={text} />;
}

function MiniText({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <span className={cx('block truncate font-mono text-[11px] leading-4', muted ? 'text-faint italic' : 'text-muted')}>
      {text || '—'}
    </span>
  );
}

/** Eigene Komponenten für das Lauflicht: nur sie rendern beim Step-Wechsel neu, nicht die ganze Karte. */
function DrumPreview({ blockId, ...props }: { blockId: string; steps: number; rows: boolean[][]; activeClass: string }) {
  const head = useSourcePlayhead(blockId, props.steps);
  return <MiniGrid {...props} head={head} />;
}

function MelodyPreview({ blockId, ...props }: { blockId: string; grid: NormalGrid; notes: GridNote[]; activeClass: string }) {
  const head = useSourcePlayhead(blockId, props.grid.steps, props.grid.bars);
  return <MiniRoll {...props} head={head} />;
}

function ChordsPreview({ blockId, chords }: { blockId: string; chords: string[] }) {
  // 1 Step pro Takt × Anzahl Akkorde → Index des gerade klingenden Akkords
  const head = useSourcePlayhead(blockId, 1, chords.length);
  return (
    <span className="block truncate font-mono text-[11px] leading-4 text-muted">
      {chords.map((c, i) => (
        <span key={i}>
          {i > 0 && <span className="text-faint"> · </span>}
          <span className={cx('rounded-sm px-0.5 transition-colors', i === head && 'bg-white/20 text-fg')}>{c}</span>
        </span>
      ))}
    </span>
  );
}

/** Schmale Lichtsäule über der gerade spielenden Spalte (rein dekorativ). */
function HeadColumn({ head, total }: { head: number | null; total: number }) {
  if (head === null || total <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-[-2px] rounded-[2px] bg-white/25 shadow-[0_0_6px_rgb(255_255_255/0.35)]"
      style={{ left: `${(head / total) * 100}%`, width: `${100 / total}%` }}
    />
  );
}

function MiniGrid({
  steps,
  rows,
  activeClass,
  compact = false,
  head = null,
}: {
  steps: number;
  rows: boolean[][];
  activeClass: string;
  compact?: boolean;
  head?: number | null;
}) {
  return (
    // Feste Höhe (16 px), die Zeilen teilen sie sich – so passt die Vorschau in die
    // 60 px hohe Klang-Karte, egal ob 2 Drum-Zeilen oder 8 Tonstufen.
    <span className={cx('relative flex h-4 flex-col', compact ? 'gap-px' : 'gap-[2px]')} aria-hidden="true">
      <HeadColumn head={head} total={steps} />
      {rows.map((row, r) => (
        <span
          key={r}
          className={cx('grid min-h-0 flex-1', compact ? 'gap-px' : 'gap-[2px]')}
          style={{ gridTemplateColumns: `repeat(${steps}, minmax(0, 1fr))` }}
        >
          {row.map((on, i) => (
            <span
              key={i}
              className={cx(
                'h-full rounded-[1px]',
                on ? activeClass : i % 4 === 0 ? 'bg-white/12' : 'bg-white/6',
                // gerade erklingender Schlag leuchtet auf
                on && i === head && 'brightness-150 saturate-150',
              )}
            />
          ))}
        </span>
      ))}
    </span>
  );
}

/**
 * Notenbild einer Melodie in fester Höhe (16 px): genutzter Tonbereich als Zeilen,
 * Haltetöne als Balken, mehrere Takte komprimiert (ganze Melodie, Taktwechsel schattiert).
 */
function MiniRoll({ grid, notes, activeClass, head = null }: { grid: NormalGrid; notes: GridNote[]; activeClass: string; head?: number | null }) {
  const degs = notes.map((n) => n.degree);
  const max = Math.max(...degs);
  const min = Math.min(...degs);
  const rowCount = max - min + 1;
  const { total, steps, bars } = grid;
  const perCell = total <= 32;
  const template = { gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` };
  return (
    <span className={cx('relative flex h-4 flex-col', rowCount > 8 ? 'gap-0' : 'gap-px')} aria-hidden="true">
      <HeadColumn head={head} total={total} />
      {Array.from({ length: rowCount }, (_, r) => {
        const d = max - r;
        return (
          <span key={d} className={cx('grid min-h-0 flex-1', perCell && 'gap-px')} style={template}>
            {perCell
              ? Array.from({ length: total }, (_, i) => (
                  <span
                    key={`c${i}`}
                    className={cx('h-full rounded-[1px]', (i % steps) % stepsPerBeat(steps) === 0 ? 'bg-white/12' : 'bg-white/6')}
                    style={{ gridRow: 1, gridColumn: i + 1 }}
                  />
                ))
              : Array.from({ length: bars }, (_, b) => (
                  <span
                    key={`b${b}`}
                    className={cx('h-full', b % 2 === 0 ? 'bg-white/6' : 'bg-white/10')}
                    style={{ gridRow: 1, gridColumn: `${b * steps + 1} / span ${steps}` }}
                  />
                ))}
            {notes
              .filter((n) => n.degree === d)
              .map((n) => (
                <span
                  key={`n${n.start}`}
                  className={cx(
                    'h-full rounded-[1px]',
                    activeClass,
                    // gerade klingender (auch gehaltener) Ton leuchtet auf
                    head !== null && head >= n.start && head < n.start + n.len && 'brightness-150 saturate-150',
                  )}
                  style={{ gridRow: 1, gridColumn: `${n.start + 1} / span ${Math.min(n.len, total - n.start)}` }}
                />
              ))}
          </span>
        );
      })}
    </span>
  );
}
