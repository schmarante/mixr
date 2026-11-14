import { useStore } from '@nanostores/react';
import { useT } from '../../../i18n/react';
import { updateBlockParams } from '../../../store/actions';
import { sampleSlots } from '../../../store/userSamples';
import type { BlockNode } from '../../../types/ast';
import { cx } from '../lib/cx';
import { samplesDialogOpen } from '../lib/projectFiles';
import { WaveIcon } from '../primitives/Icons';

/**
 * Eigene Samples als Vorschläge im Sample-Baustein: Klick setzt das Muster auf den
 * Klang (bzw. hängt ihn mit Shift an). Ohne Slots ein Hinweis zum Samples-Panel.
 */
export function SampleSuggestions({ block }: { block: BlockNode }) {
  const { t } = useT();
  const slots = useStore(sampleSlots);
  const pattern = typeof block.params['pattern'] === 'string' ? block.params['pattern'].trim() : '';

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('ui.samples.suggestions')}>
      <span className="mr-1 text-xs text-faint">{t('ui.samples.suggestions')}</span>
      {slots.map((s) => {
        const active = pattern.split(/[\s\[\]<>*~,]+/).some((w) => w.split(':')[0] === s.name);
        return (
          <button
            key={s.id}
            type="button"
            onClick={(e) => updateBlockParams(block.id, { pattern: e.shiftKey && pattern ? `${pattern} ${s.name}` : s.name })}
            title={t('ui.samples.useTooltip', { name: s.name })}
            aria-pressed={active}
            className={cx(
              'h-7 rounded-lg px-2 font-mono text-xs ring-1 transition-colors',
              active ? 'bg-accent-soft text-accent ring-accent/50' : 'bg-card text-fg ring-line hover:bg-raised',
            )}
          >
            {s.name}
            {s.files.length > 1 && <span className="ml-1 text-faint">×{s.files.length}</span>}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => samplesDialogOpen.set(true)}
        aria-haspopup="dialog"
        className="flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-muted transition-colors hover:bg-hover hover:text-fg"
      >
        <WaveIcon size={13} />
        {slots.length > 0 ? t('ui.samples.manage') : t('ui.samples.addOwn')}
      </button>
    </div>
  );
}
