import { useStore } from '@nanostores/react';
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { useT } from '../../../i18n/react';
import { projectSettings, uiState } from '../../../store/agentBus';
import {
  addSection,
  duplicateSection,
  moveSection,
  removeArrangement,
  removeSection,
  selectNode,
  setLoopSection,
  setSectionCell,
  updateSection,
} from '../../../store/actions';
import type { Arrangement, ArrangementSection, ResolvedTrack, SectionCell } from '../../../types/ast';
import { formatDuration, sectionName, totalCycles, usePlayProgress, usePlayingSection, variantBadge, workspaceView } from '../lib/arrangement';
import { cx } from '../lib/cx';
import { trackColor } from '../lib/trackColors';
import { IconButton } from '../primitives/IconButton';
import { MinusIcon, PlusIcon, RepeatIcon, TrashIcon } from '../primitives/Icons';
import { OverflowMenu, type MenuItem } from '../primitives/Menu';
import { Popover } from '../primitives/Popover';
import { SongPlayBar } from './SongPlayBar';

/** Pixel pro Takt und Mindestbreite eines Abschnitts. */
const PX_PER_CYCLE = 18;
const MIN_WIDTH = 150;
/** Breite der Spurnamen-Spalte (fest, damit die Positionslinie ohne Messen passt); schmaler auf dem Handy. */
const NAME_WIDTH_WIDE = 152;
const NAME_WIDTH_NARROW = 108;
const narrowQuery = '(max-width: 639px)';
function useNameWidth(): number {
  const narrow = useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(narrowQuery);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(narrowQuery).matches,
    () => false,
  );
  return narrow ? NAME_WIDTH_NARROW : NAME_WIDTH_WIDE;
}

export function sectionWidth(s: ArrangementSection): number {
  return Math.max(MIN_WIDTH, s.cycles * PX_PER_CYCLE);
}

const MAX_CYCLES = 256;

/* ------------------------------------------------------------------ */
/* Kopfzeile eines Abschnitts                                          */
/* ------------------------------------------------------------------ */

function SectionHeader({
  arr,
  section,
  index,
  playing,
}: {
  arr: Arrangement;
  section: ArrangementSection;
  index: number;
  playing: boolean;
}) {
  const { t } = useT();
  const name = sectionName(section, index);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.name ?? '');
  const looping = arr.loopSection === section.id;
  const count = arr.sections.length;

  const finish = (save: boolean) => {
    if (save && draft.trim() !== (section.name ?? '')) updateSection(section.id, { name: draft });
    setEditing(false);
  };

  const duplicate = () => duplicateSection(section.id);

  const items: MenuItem[] = [
    { id: 'before', label: t('ui.song.insertBefore'), onSelect: () => addSection(section.cycles, index) },
    { id: 'after', label: t('ui.song.insertAfter'), onSelect: () => addSection(section.cycles, index + 1) },
    { id: 'duplicate', label: t('ui.song.duplicate'), onSelect: duplicate },
    { id: 'left', label: t('ui.song.moveLeft'), onSelect: () => moveSection(section.id, index - 1), disabled: index === 0 },
    { id: 'right', label: t('ui.song.moveRight'), onSelect: () => moveSection(section.id, index + 1), disabled: index === count - 1 },
    { id: 'rename', label: t('ui.song.rename'), onSelect: () => { setDraft(section.name ?? ''); setEditing(true); } },
    { id: 'delete', label: t('ui.song.deleteSection'), onSelect: () => removeSection(section.id), danger: true },
  ];

  return (
    <div
      className={cx(
        'flex h-full flex-col gap-1 rounded-xl border px-2 py-1.5 transition-colors',
        looping ? 'border-accent/70 bg-accent-soft' : playing ? 'border-fg/40 bg-raised' : 'border-line bg-card',
      )}
    >
      <div className="flex min-w-0 items-center gap-0.5">
        {editing ? (
          <input
            autoFocus
            value={draft}
            maxLength={32}
            placeholder={name}
            aria-label={t('ui.song.nameLabel')}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => finish(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finish(true);
              if (e.key === 'Escape') {
                e.stopPropagation();
                finish(false);
              }
            }}
            className="h-6 min-w-0 flex-1 rounded-md bg-canvas px-1.5 text-sm font-semibold text-fg ring-1 ring-accent outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(section.name ?? '');
              setEditing(true);
            }}
            title={`${name} – ${t('ui.song.renameTooltip')}`}
            className={cx('min-w-0 flex-1 truncate rounded-md px-1 text-left text-sm font-semibold hover:bg-hover', section.name ? 'text-fg' : 'text-muted')}
          >
            {name}
          </button>
        )}
        <IconButton
          label={looping ? t('ui.song.loopOff') : t('ui.song.loopOn', { name })}
          size="xs"
          variant="toggle"
          pressed={looping}
          tooltip="bottom"
          onClick={() => setLoopSection(looping ? null : section.id)}
        >
          <RepeatIcon size={13} />
        </IconButton>
        <OverflowMenu label={t('ui.song.sectionMenu', { name })} items={items} size="xs" />
      </div>
      <div className="flex items-center gap-0.5 text-xs text-muted" role="group" aria-label={t('ui.song.lengthOf', { name })}>
        <IconButton
          label={t('ui.song.shorter')}
          size="xs"
          tooltip={false}
          disabled={section.cycles <= 1}
          onClick={() => updateSection(section.id, { cycles: Math.max(1, section.cycles - 1) }, true)}
        >
          <MinusIcon size={12} />
        </IconButton>
        <span className="min-w-12 text-center tabular-nums" aria-live="polite">
          {t('ui.song.bars', { count: section.cycles })}
        </span>
        <IconButton
          label={t('ui.song.longer')}
          size="xs"
          tooltip={false}
          disabled={section.cycles >= MAX_CYCLES}
          onClick={() => updateSection(section.id, { cycles: Math.min(MAX_CYCLES, section.cycles + 1) }, true)}
        >
          <PlusIcon size={12} />
        </IconButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Variante bearbeiten                                                 */
/* ------------------------------------------------------------------ */

function VariantEditor({
  trackId,
  trackName,
  section,
  sectionLabel,
  cell,
  anchorRef,
  onClose,
}: {
  trackId: string;
  trackName: string;
  section: ArrangementSection;
  sectionLabel: string;
  cell: SectionCell;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const { t } = useT();
  const id = useId();
  const [draft, setDraft] = useState(cell.code ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const save = (code: string, coalesce: boolean) => setSectionCell(trackId, section.id, { on: true, code }, coalesce);

  return (
    <Popover open onClose={onClose} anchorRef={anchorRef} label={t('ui.song.variantTitle', { track: trackName, section: sectionLabel })} initialFocusRef={inputRef}>
      <div className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2.5 p-4" data-keep-space>
        <p className="text-sm font-semibold text-fg">{t('ui.song.variantTitle', { track: trackName, section: sectionLabel })}</p>
        <label htmlFor={id} className="sr-only">
          {t('ui.song.variantLabel')}
        </label>
        <input
          ref={inputRef}
          id={id}
          value={draft}
          spellCheck={false}
          autoComplete="off"
          placeholder=".lpf(800)"
          onChange={(e) => {
            setDraft(e.target.value);
            save(e.target.value, true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onClose();
          }}
          className="h-9 rounded-xl border border-line-strong bg-canvas px-3 font-mono text-[13px] text-fg transition-colors hover:border-faint focus:border-accent focus:outline-none"
        />
        <p className="text-xs leading-snug text-muted">{t('ui.song.variantHint')}</p>
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            disabled={draft.trim() === '' && !cell.code}
            onClick={() => {
              save('', false);
              onClose();
            }}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-40"
          >
            <TrashIcon size={14} />
            {t('ui.song.variantRemove')}
          </button>
          <button type="button" onClick={onClose} className="h-8 rounded-lg bg-card px-3 text-sm font-medium text-fg ring-1 ring-line hover:bg-raised">
            {t('ui.song.done')}
          </button>
        </div>
      </div>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Zelle                                                               */
/* ------------------------------------------------------------------ */

interface CellProps {
  r: number;
  c: number;
  rt: ResolvedTrack;
  section: ArrangementSection;
  sectionLabel: string;
  cell: SectionCell;
  implicit: boolean;
  playing: boolean;
  focused: boolean;
  onDown: (e: PointerEvent<HTMLButtonElement>, r: number, c: number) => void;
  onToggle: (r: number, c: number) => void;
  onEnter: (r: number, c: number) => void;
  onKey: (e: KeyboardEvent<HTMLButtonElement>, r: number, c: number) => void;
}

function Cell({ r, c, rt, section, sectionLabel, cell, implicit, playing, focused, onDown, onToggle, onEnter, onKey }: CellProps) {
  const { t } = useT();
  const color = trackColor(rt.track.params.color);
  const [editing, setEditing] = useState(false);
  const variantRef = useRef<HTMLButtonElement>(null);
  const name = rt.track.params.name;
  const state = cell.on ? (cell.code ? t('ui.song.cellOnVariant', { code: cell.code }) : t('ui.song.cellOn')) : t('ui.song.cellOff');

  return (
    <div role="gridcell" className="group/cell relative h-full shrink-0 p-[3px]" style={{ width: sectionWidth(section) }}>
      <button
        type="button"
        data-cell={`${r}-${c}`}
        tabIndex={focused ? 0 : -1}
        aria-pressed={cell.on}
        aria-label={t('ui.song.cellLabel', { track: name, section: sectionLabel, state })}
        onPointerDown={(e) => onDown(e, r, c)}
        onPointerEnter={() => onEnter(r, c)}
        onClick={(e) => {
          // Nur Tastatur-Klicks (detail 0) – Maus/Touch laufen über pointerdown
          if (e.detail === 0) onToggle(r, c);
        }}
        onKeyDown={(e) => onKey(e, r, c)}
        className={cx(
          'h-full w-full touch-none rounded-lg transition-[background-color,box-shadow] duration-100 focus-visible:outline-offset-1',
          cell.on
            ? cx(color.solid, 'opacity-85 hover:opacity-100', implicit && 'opacity-45 bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgb(0_0_0/0.18)_6px_12px)]')
            : 'bg-cell ring-1 ring-white/[0.05] ring-inset hover:bg-hover',
          playing && 'ring-2 ring-fg/70',
        )}
      />
      {cell.on && (
        <button
          ref={variantRef}
          type="button"
          onClick={() => setEditing(true)}
          aria-haspopup="dialog"
          aria-label={cell.code ? t('ui.song.variantEdit', { code: cell.code }) : t('ui.song.variantAdd', { track: name, section: sectionLabel })}
          title={cell.code ?? t('ui.song.variantAddTooltip')}
          className={cx(
            'absolute top-1.5 right-1.5 flex h-5 items-center rounded-md px-1.5 font-mono text-[10px] font-semibold transition-opacity',
            cell.code
              ? 'bg-canvas/85 text-fg ring-1 ring-black/20'
              : 'bg-canvas/60 text-muted opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-60',
          )}
        >
          {cell.code ? variantBadge(cell.code) : '+ fx'}
        </button>
      )}
      {editing && (
        <VariantEditor
          trackId={rt.track.id}
          trackName={name}
          section={section}
          sectionLabel={sectionLabel}
          cell={cell}
          anchorRef={variantRef}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Positionslinie                                                      */
/* ------------------------------------------------------------------ */

function PlayLine({ arr, offsets, nameWidth }: { arr: Arrangement; offsets: number[]; nameWidth: number }) {
  const { index, frac } = usePlayProgress(arr);
  if (index < 0) return null;
  const s = arr.sections[index];
  if (!s) return null;
  const x = nameWidth + (offsets[index] ?? 0) + frac * sectionWidth(s);
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 rounded-full bg-fg/85 shadow-[0_0_8px_rgb(255_255_255/0.5)]"
      style={{ left: x }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Song-Ansicht                                                        */
/* ------------------------------------------------------------------ */

/**
 * Song-Zeitleiste: Abschnitte als Spalten (Breite ∝ Takte), pro Spur eine Zeile mit
 * an/aus-Zellen (Klick, Ziehen malt) und optionalen Varianten. Kopfzeile und
 * Spurnamen bleiben beim Scrollen stehen; Positionslinie folgt der Wiedergabe.
 */
export function SongView({ arr, tracks }: { arr: Arrangement; tracks: ResolvedTrack[] }) {
  const { t } = useT();
  const bpm = useStore(projectSettings).bpm;
  const selectedId = useStore(uiState).selectedNodeId;
  const playingIndex = usePlayingSection(arr);
  const paint = useRef<boolean | null>(null);
  /** Undo-Schlüssel des laufenden Mal-Strichs (false = Einzelaktion, z. B. Tastatur). */
  const stroke = useRef<string | false>(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState({ r: 0, c: 0 });
  const nameWidth = useNameWidth();

  useEffect(() => {
    const end = () => ((paint.current = null), (stroke.current = false));
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);

  const sections = arr.sections;
  const total = totalCycles(arr);
  const offsets: number[] = [];
  sections.reduce((x, s) => {
    offsets.push(x);
    return x + sectionWidth(s);
  }, 0);
  const loopIndex = arr.loopSection ? sections.findIndex((s) => s.id === arr.loopSection) : -1;
  const loopName = loopIndex >= 0 ? sectionName(sections[loopIndex]!, loopIndex) : '';

  const cellOf = (trackId: string, sectionId: string): { cell: SectionCell; implicit: boolean } => {
    const row = arr.cells[trackId];
    if (!row) return { cell: { on: true }, implicit: true };
    return { cell: row[sectionId] ?? { on: false }, implicit: false };
  };

  const apply = (r: number, c: number, on: boolean) => {
    const rt = tracks[r];
    const s = sections[c];
    if (!rt || !s) return;
    const { cell } = cellOf(rt.track.id, s.id);
    if (cell.on === on && arr.cells[rt.track.id]) return;
    // ein Mal-Strich (Klick + Ziehen) = ein Undo-Schritt
    setSectionCell(rt.track.id, s.id, cell.code ? { on, code: cell.code } : { on }, stroke.current);
  };

  const toggle = (r: number, c: number): boolean | null => {
    const rt = tracks[r];
    const s = sections[c];
    if (!rt || !s) return null;
    const mode = !cellOf(rt.track.id, s.id).cell.on;
    setFocus({ r, c });
    apply(r, c, mode);
    return mode;
  };

  const onDown = (e: PointerEvent<HTMLButtonElement>, r: number, c: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Touch: implizite Pointer-Capture freigeben, damit Malen über Zellen funktioniert
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    stroke.current = `paint:${Date.now()}`;
    paint.current = toggle(r, c);
  };

  const onEnter = (r: number, c: number) => {
    if (paint.current !== null) apply(r, c, paint.current);
  };

  const focusCell = (r: number, c: number) => {
    const nr = Math.max(0, Math.min(tracks.length - 1, r));
    const nc = Math.max(0, Math.min(sections.length - 1, c));
    setFocus({ r: nr, c: nc });
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-cell="${nr}-${nc}"]`)?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, r: number, c: number) => {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [r - 1, c],
      ArrowDown: [r + 1, c],
      ArrowLeft: [r, c - 1],
      ArrowRight: [r, c + 1],
      Home: [r, 0],
      End: [r, sections.length - 1],
    };
    const m = moves[e.key];
    if (m && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      focusCell(m[0], m[1]);
    }
  };

  const r0 = Math.min(focus.r, tracks.length - 1);
  const c0 = Math.min(focus.c, sections.length - 1);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Kopf: Länge, Schleife, Abschnitt hinzufügen */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm text-muted">
          {t('ui.song.summary', { sections: t('ui.song.sectionCount', { count: sections.length }), bars: t('ui.song.bars', { count: total }), time: formatDuration(total, bpm) })}
        </p>
        {loopIndex >= 0 ? (
          <div className="flex items-center gap-1.5 rounded-xl bg-accent-soft py-1 pr-1 pl-2.5 text-sm text-accent ring-1 ring-accent/40" role="status">
            <RepeatIcon size={14} />
            <span className="font-medium">{t('ui.song.looping', { name: loopName })}</span>
            <button type="button" onClick={() => setLoopSection(null)} className="h-7 rounded-lg bg-panel px-2.5 text-sm font-medium text-fg hover:bg-raised">
              {t('ui.song.wholeSong')}
            </button>
          </div>
        ) : (
          <span className="text-xs text-faint">{t('ui.song.tip')}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => addSection(sections[sections.length - 1]?.cycles ?? 8)}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-card px-3 text-sm text-fg ring-1 ring-line transition-colors hover:bg-raised"
          >
            <PlusIcon size={15} />
            {t('ui.song.addSection')}
          </button>
          <OverflowMenu
            label={t('ui.song.menu')}
            items={[
              { id: 'tracks', label: t('ui.song.showTracks'), onSelect: () => workspaceView.set('tracks') },
              { id: 'remove', label: t('ui.song.removeArrangement'), onSelect: () => { removeArrangement(); workspaceView.set('tracks'); }, danger: true },
            ]}
          />
        </div>
      </div>

      <SongPlayBar arr={arr} />

      {/* Zeitleiste (scrollt in sich – Kopf und Spurnamen bleiben stehen) */}
      <div ref={gridRef} className="glass-scroll min-h-0 flex-1 overflow-auto rounded-2xl border border-line bg-panel" data-keep-space>
        <div className="relative inline-flex min-w-full flex-col pb-2" role="grid" aria-label={t('ui.song.gridLabel')} aria-rowcount={tracks.length + 1}>
          <div className="sticky top-0 z-20 flex border-b border-line bg-panel-solid/90 backdrop-blur-sm" role="row">
            <div className="sticky left-0 z-30 flex shrink-0 items-end bg-panel-solid px-3 pb-2 text-xs text-faint" style={{ width: nameWidth }} role="columnheader">
              {t('ui.song.tracksColumn')}
            </div>
            {sections.map((s, i) => (
              <div key={s.id} className="h-[4.25rem] shrink-0 p-[3px] pt-2" style={{ width: sectionWidth(s) }} role="columnheader">
                <SectionHeader arr={arr} section={s} index={i} playing={i === playingIndex} />
              </div>
            ))}
          </div>

          {tracks.map((rt, r) => {
            const color = trackColor(rt.track.params.color);
            const implicit = !arr.cells[rt.track.id];
            const selected = selectedId === rt.track.id;
            return (
              <div key={rt.track.id} className="flex h-14" role="row">
                <div className="sticky left-0 z-20 flex shrink-0 items-center bg-panel-solid/90 backdrop-blur-sm px-2" style={{ width: nameWidth }} role="rowheader">
                  <button
                    type="button"
                    onClick={() => selectNode(selected ? null : rt.track.id)}
                    aria-pressed={selected}
                    title={t('ui.song.trackSettings')}
                    className={cx(
                      'flex h-11 w-full min-w-0 items-center gap-2 rounded-lg px-1.5 text-left transition-colors hover:bg-hover',
                      selected && color.soft,
                      rt.track.params.muted && 'opacity-50',
                    )}
                  >
                    <span className={cx('h-7 w-1.5 shrink-0 rounded-full', color.solid)} aria-hidden="true" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium text-fg">{rt.track.params.name}</span>
                      {implicit && <span className="truncate text-[11px] text-faint">{t('ui.song.always')}</span>}
                    </span>
                  </button>
                </div>
                {sections.map((s, c) => {
                  const { cell } = cellOf(rt.track.id, s.id);
                  return (
                    <Cell
                      key={s.id}
                      r={r}
                      c={c}
                      rt={rt}
                      section={s}
                      sectionLabel={sectionName(s, c)}
                      cell={cell}
                      implicit={implicit}
                      playing={c === playingIndex && cell.on}
                      focused={r === r0 && c === c0}
                      onDown={onDown}
                      onToggle={(rr, cc) => void toggle(rr, cc)}
                      onEnter={onEnter}
                      onKey={onKey}
                    />
                  );
                })}
              </div>
            );
          })}
          <PlayLine arr={arr} offsets={offsets} nameWidth={nameWidth} />
        </div>
      </div>
    </div>
  );
}
