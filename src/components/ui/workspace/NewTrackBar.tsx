import { blocksOfKind } from '../../../blocks/catalog';
import { blockDescription, blockLabel } from '../../../blocks/text';
import { useT } from '../../../i18n/react';
import { resolvedTracks } from '../../../store/agentBus';
import { addTrack, selectNode } from '../../../store/actions';
import type { BlockType } from '../../../types/ast';
import { PlusIcon } from '../primitives/Icons';

function addTrackWithSource(type: BlockType) {
  const trackId = addTrack(type);
  const source = resolvedTracks.get().find((t) => t.track.id === trackId)?.chain[0];
  selectNode(source?.id ?? trackId);
}

/** „+ Neue Spur“ mit direkter Quellen-Schnellwahl (ein Klick statt zwei). */
export function NewTrackBar() {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-3.5 sm:flex-row sm:items-center">
      <span className="flex items-center gap-2 text-sm font-medium text-muted">
        <PlusIcon size={16} />
        {t('ui.workspace.newTrack')}
      </span>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('ui.workspace.newTrackGroup')}>
        {blocksOfKind('source').map((def) => (
          <button
            key={def.type}
            type="button"
            onClick={() => addTrackWithSource(def.type)}
            title={blockDescription(def.type)}
            aria-label={t('ui.workspace.newTrackWith', { source: blockLabel(def.type) })}
            className="flex h-9 items-center gap-2 rounded-xl bg-card px-3 text-sm text-fg ring-1 ring-line transition-colors hover:bg-raised hover:ring-line-strong"
          >
            <span aria-hidden="true">{def.icon}</span>
            {blockLabel(def.type)}
          </button>
        ))}
      </div>
    </div>
  );
}
