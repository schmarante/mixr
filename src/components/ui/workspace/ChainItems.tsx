import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { getBlockDef } from '../../../blocks/catalog';
import { blockLabel } from '../../../blocks/text';
import { t } from '../../../i18n';
import { useT } from '../../../i18n/react';
import { addBlock, removeBlock, selectNode, setBlockBypassed } from '../../../store/actions';
import type { BlockNode, BlockType, ResolvedTrack } from '../../../types/ast';
import { cx } from '../lib/cx';
import { blockSummary } from '../lib/params';
import type { TrackColorClasses } from '../lib/trackColors';
import { CloseIcon, PlusIcon, PowerIcon, WarningIcon } from '../primitives/Icons';
import { BlockPicker } from './BlockPicker';
import { endDrag, handleDragOver, startDrag } from './dnd';
import { MiniPreview } from './MiniPreview';

interface ChainItemProps {
  block: BlockNode;
  rt: ResolvedTrack;
  index: number;
  selected: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  diagnostic: string | null;
  color: TrackColorClasses;
}

/** Enter aktiviert (Leertaste bleibt global für Play/Stop reserviert). */
function onEnter(e: KeyboardEvent<HTMLElement>, fn: () => void) {
  if (e.key === 'Enter') {
    e.preventDefault();
    fn();
  }
}

function DropIndicator({ side }: { side: 'before' | 'after' }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'pointer-events-none absolute inset-y-1 z-10 w-[3px] rounded-full bg-accent shadow-[0_0_10px_rgb(255_138_76/0.8)]',
        side === 'before' ? '-left-[11px]' : '-right-[11px]',
      )}
    />
  );
}

/** Kleine Schwebe-Leiste (Bypass, Entfernen) – bei Hover, Fokus oder Auswahl sichtbar. */
function ItemActions({ block, label, visible }: { block: BlockNode; label: string; visible: boolean }) {
  const { t } = useT();
  const bypassed = block.bypassed === true;
  return (
    <div
      className={cx(
        'absolute -top-3 right-2 z-10 flex gap-0.5 rounded-full border border-line-strong bg-raised p-0.5 shadow-lg shadow-black/40 transition-opacity duration-150',
        visible
          ? 'opacity-100'
          : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
      )}
    >
      <button
        type="button"
        aria-label={bypassed ? t('ui.chain.turnOn', { label }) : t('ui.chain.bypass', { label })}
        title={bypassed ? t('ui.chain.turnOnTooltip') : t('ui.chain.bypassTooltip')}
        aria-pressed={!bypassed}
        onClick={(e) => {
          e.stopPropagation();
          setBlockBypassed(block.id, !bypassed);
        }}
        className={cx(
          'flex size-6 items-center justify-center rounded-full transition-colors hover:bg-hover',
          bypassed ? 'text-faint' : 'text-ok',
        )}
      >
        <PowerIcon size={13} />
      </button>
      <button
        type="button"
        aria-label={t('ui.chain.remove', { label })}
        title={t('ui.chain.removeTooltip', { key: t('common.keys.delete') })}
        onClick={(e) => {
          e.stopPropagation();
          removeBlock(block.id);
        }}
        className="flex size-6 items-center justify-center rounded-full text-muted transition-colors hover:bg-danger-soft hover:text-danger"
      >
        <CloseIcon size={13} />
      </button>
    </div>
  );
}

function useDragHandlers(block: BlockNode, rt: ResolvedTrack, index: number, label: string) {
  const [dragging, setDragging] = useState(false);
  const isSource = getBlockDef(block.type).kind === 'source';
  return {
    dragging,
    props: {
      draggable: true,
      onDragStart: (e: DragEvent<HTMLElement>) => {
        startDrag(e, { blockId: block.id, fromTrackId: rt.track.id, isSource }, label);
        setDragging(true);
      },
      onDragEnd: () => {
        setDragging(false);
        endDrag();
      },
      onDragOver: (e: DragEvent<HTMLElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        const before = e.clientX < r.left + r.width / 2;
        handleDragOver(e, rt, before ? index : index + 1);
      },
    },
  };
}

/** Zugänglicher Name eines Chips/einer Karte: „Hall: 40 % (ausgeschaltet) – einstellen“. */
function itemAriaLabel(name: string, bypassed: boolean): string {
  return t('ui.chain.edit', { name: bypassed ? t('ui.chain.offSuffix', { name }) : name });
}

/** Kompakter Baustein-Chip (Rhythmus / Effekt). */
export function BlockChip({ block, rt, index, selected, dropBefore, dropAfter, diagnostic }: ChainItemProps) {
  useT();
  const def = getBlockDef(block.type);
  const label = blockLabel(block.type);
  const summary = blockSummary(block);
  const bypassed = block.bypassed === true;
  const { dragging, props } = useDragHandlers(block, rt, index, label);

  return (
    <div className={cx('group relative', dragging && 'opacity-40')} data-node-id={block.id} {...props}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => selectNode(block.id)}
        onKeyDown={(e) => onEnter(e, () => selectNode(block.id))}
        aria-current={selected ? 'true' : undefined}
        aria-label={itemAriaLabel(summary ? t('ui.chain.withSummary', { label, summary }) : label, bypassed)}
        className={cx(
          'flex h-[60px] min-w-28 max-w-56 cursor-grab items-center gap-2.5 rounded-xl border px-3 text-left transition-all duration-150 active:cursor-grabbing',
          selected
            ? 'border-accent bg-raised ring-2 ring-accent/40'
            : 'border-line-strong bg-card hover:border-faint hover:bg-raised',
          bypassed && 'border-dashed opacity-55',
        )}
      >
        <span className={cx('text-lg leading-none', bypassed && 'grayscale')} aria-hidden="true">
          {def.icon}
        </span>
        <span className="min-w-0">
          <span className={cx('block truncate text-sm font-medium text-fg', bypassed && 'line-through decoration-faint')}>
            {label}
          </span>
          {summary && <span className="block truncate font-mono text-xs text-muted">{summary}</span>}
        </span>
      </div>
      {diagnostic && <DiagnosticBadge text={diagnostic} />}
      <ItemActions block={block} label={label} visible={selected} />
      {dropBefore && <DropIndicator side="before" />}
      {dropAfter && <DropIndicator side="after" />}
    </div>
  );
}

function DiagnosticBadge({ text }: { text: string }) {
  const { t } = useT();
  return (
    <span
      title={text}
      className="absolute -bottom-1.5 -left-1.5 z-10 flex size-5 items-center justify-center rounded-full bg-warn text-canvas shadow"
    >
      <WarningIcon size={11} strokeWidth={2.6} />
      <span className="sr-only">{t('ui.chain.notice', { text })}</span>
    </span>
  );
}

/** Größere Karte für die Klangquelle mit Mini-Vorschau. */
export function SourceCard({ block, rt, index, selected, dropBefore, dropAfter, diagnostic, color }: ChainItemProps) {
  useT();
  const def = getBlockDef(block.type);
  const label = blockLabel(block.type);
  const bypassed = block.bypassed === true;
  const { dragging, props } = useDragHandlers(block, rt, index, label);

  return (
    <div className={cx('group relative', dragging && 'opacity-40')} data-node-id={block.id} {...props}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => selectNode(block.id)}
        onKeyDown={(e) => onEnter(e, () => selectNode(block.id))}
        aria-current={selected ? 'true' : undefined}
        aria-label={itemAriaLabel(t('ui.chain.sourceName', { label }), bypassed)}
        className={cx(
          'flex h-[60px] w-48 cursor-grab flex-col justify-between gap-1.5 rounded-xl border px-3 py-2 text-left transition-all duration-150 active:cursor-grabbing sm:w-56',
          selected ? 'border-accent ring-2 ring-accent/40' : cx('hover:border-faint', color.border),
          color.soft,
          bypassed && 'border-dashed opacity-55',
        )}
      >
        <span className="flex items-center gap-2">
          <span className="text-base leading-none" aria-hidden="true">
            {def.icon}
          </span>
          <span className={cx('text-sm leading-5 font-semibold', color.text)}>{label}</span>
        </span>
        <span className="block w-full">
          <MiniPreview block={block} activeClass={color.solid} />
        </span>
      </div>
      {diagnostic && <DiagnosticBadge text={diagnostic} />}
      <ItemActions block={block} label={label} visible={selected} />
      {dropBefore && <DropIndicator side="before" />}
      {dropAfter && <DropIndicator side="after" />}
    </div>
  );
}

/** Platzhalter, wenn die Spur noch keine Klangquelle hat. */
export function SourcePlaceholder({ rt, dropActive }: { rt: ResolvedTrack; dropActive: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div className="relative" onDragOver={(e) => handleDragOver(e, rt, 0)}>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cx(
          'flex h-[60px] w-48 flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-dashed text-sm transition-colors sm:w-56',
          dropActive ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong text-muted hover:border-accent/60 hover:text-fg',
        )}
      >
        <PlusIcon size={18} />
        <span className="font-medium">{t('ui.workspace.chooseSound')}</span>
      </button>
      <BlockPicker
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={ref}
        kinds={['source']}
        title={t('ui.workspace.chooseSoundTitle')}
        onPick={(type: BlockType) => selectNode(addBlock(rt.track.id, type))}
      />
    </div>
  );
}

/** „+“ am Kettenende: öffnet den Baustein-Picker (Rhythmus & Effekte). */
export function AddBlockButton({ rt, compact, dropActive }: { rt: ResolvedTrack; compact: boolean; dropActive: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('ui.workspace.addBlock')}
        title={t('ui.workspace.addBlockTooltip')}
        className={cx(
          'flex h-[60px] items-center justify-center gap-1.5 rounded-xl border border-dashed text-sm font-medium transition-colors',
          open || dropActive
            ? 'border-accent bg-accent-soft text-accent'
            : 'border-line-strong text-muted hover:border-accent/60 hover:text-fg',
          compact ? 'w-12' : 'px-4',
        )}
      >
        <PlusIcon size={18} />
        {!compact && <span>{t('ui.workspace.addBlockShort')}</span>}
      </button>
      <BlockPicker
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={ref}
        kinds={['modifier', 'effect']}
        title={t('ui.workspace.addBlock')}
        onPick={(type) => selectNode(addBlock(rt.track.id, type))}
      />
    </>
  );
}
