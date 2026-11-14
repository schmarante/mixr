import type { DragEvent } from 'react';
import { getBlockDef } from '../../../blocks/catalog';
import { useT } from '../../../i18n/react';
import { selectNode } from '../../../store/actions';
import type { ResolvedTrack } from '../../../types/ast';
import { cx } from '../lib/cx';
import { trackColor } from '../lib/trackColors';
import { AddBlockButton, BlockChip, SourceCard, SourcePlaceholder } from './ChainItems';
import { dropTarget, handleDragOver, handleDrop, hasSource } from './dnd';
import { TrackHeader } from './TrackHeader';

interface TrackRowProps {
  rt: ResolvedTrack;
  index: number;
  count: number;
  selectedId: string | null;
  /** Aktive Einfügeposition in DIESER Spur (oder null). */
  dropGap: number | null;
  anySolo: boolean;
  diagnostics: Map<string, string>;
  /** Wird gerade eine Klangquelle gezogen? */
  draggingSource: boolean;
}

/** Verbindungslinie zwischen Bausteinen (Signalfluss) – auch Ablagefläche. */
function Connector({ rt, gap }: { rt: ResolvedTrack; gap: number }) {
  return (
    <span
      aria-hidden="true"
      onDragOver={(e) => handleDragOver(e, rt, gap)}
      className="flex h-[60px] w-5 shrink-0 items-center"
    >
      <span className="h-px w-full bg-line-strong" />
    </span>
  );
}

/** Ein Kanalzug: Spurkopf + horizontale Kette aus Bausteinen. */
export function TrackRow({ rt, index, count, selectedId, dropGap, anySolo, diagnostics, draggingSource }: TrackRowProps) {
  const { t } = useT();
  const { track, chain } = rt;
  const color = trackColor(track.params.color);
  const withSource = hasSource(rt);
  const trackSelected = selectedId === track.id;
  const containsSelection = chain.some((b) => b.id === selectedId);
  const dimmed = track.params.muted || (anySolo && !track.params.solo);
  const nonSourceCount = chain.length - (withSource ? 1 : 0);

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    if (dropTarget.get()?.trackId === track.id) dropTarget.set(null);
  };

  return (
    <div
      role="group"
      aria-label={t('ui.workspace.trackGroup', { name: track.params.name })}
      className={cx(
        'relative flex flex-col overflow-visible border bg-panel transition-colors duration-150 @3xl:flex-row',
        trackSelected ? cx('ring-1', color.ring, color.border) : containsSelection ? 'border-line-strong' : 'border-line',
      )}
    >
      {/* Farbstrich bündig am linken Rand, über die volle Höhe der Spur */}
      <span aria-hidden="true" className={cx('pointer-events-none absolute inset-y-0 left-0 w-1', color.solid, dimmed && 'opacity-40')} />
      <TrackHeader track={track} index={index} count={count} selected={trackSelected} color={color} />

      <div
        onDragOver={(e) => handleDragOver(e, rt, chain.length)}
        onDrop={(e) => handleDrop(e, rt)}
        onDragLeave={onDragLeave}
        onClick={(e) => {
          if (e.target === e.currentTarget) selectNode(track.id);
        }}
        className={cx(
          'flex min-w-0 flex-1 flex-wrap items-center gap-y-2 border-t border-line px-4 py-2.5 transition-opacity @3xl:border-t-0 @3xl:border-l',
          dimmed && 'opacity-45',
        )}
      >
        {/* Verbinder gehören zum FOLGENDEN Baustein, damit beim Umbruch keine Linie am Zeilenende hängt */}
        {!withSource && <SourcePlaceholder rt={rt} dropActive={draggingSource && dropGap === 0} />}
        {chain.map((block, i) => {
          const isSource = getBlockDef(block.type).kind === 'source';
          const common = {
            block,
            rt,
            index: i,
            selected: selectedId === block.id,
            dropBefore: dropGap === i && !(isSource && i === 0) && !draggingSource,
            dropAfter: false,
            diagnostic: diagnostics.get(block.id) ?? null,
            color,
          };
          if (isSource && i === 0) return <SourceCard key={block.id} {...common} />;
          return (
            <div key={block.id} className="flex items-center">
              <Connector rt={rt} gap={i} />
              <BlockChip {...common} />
            </div>
          );
        })}
        <div className="flex items-center">
          <Connector rt={rt} gap={chain.length} />
          <AddBlockButton rt={rt} compact={nonSourceCount >= 3} dropActive={dropGap === chain.length && !draggingSource} />
        </div>
      </div>
    </div>
  );
}
