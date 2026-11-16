import { useStore } from '@nanostores/react';
import { useT } from '../../../i18n/react';
import { createArrangement } from '../../../store/actions';
import type { Arrangement } from '../../../types/ast';
import { workspaceView } from '../lib/arrangement';
import { SongPlayBar } from './SongPlayBar';
import { cx } from '../lib/cx';
import { TimelineIcon } from '../primitives/Icons';

/** Umschalter „Spuren | Song“ (nur mit Song-Ablauf). */
function ViewSwitch() {
  const { t } = useT();
  const view = useStore(workspaceView);
  const options = [
    { value: 'tracks' as const, label: t('ui.song.viewTracks') },
    { value: 'song' as const, label: t('ui.song.viewSong') },
  ];
  return (
    <fieldset className="flex shrink-0">
      <legend className="sr-only">{t('ui.song.view')}</legend>
      <span className="flex gap-1 rounded-xl bg-canvas p-1 ring-1 ring-line">
        {options.map((o) => (
          <label
            key={o.value}
            className={cx(
              'relative flex h-7 cursor-pointer items-center rounded-lg px-3 text-sm transition-colors',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent',
              view === o.value ? 'bg-raised font-medium text-fg shadow-sm shadow-black/30' : 'text-muted hover:text-fg',
            )}
          >
            <input type="radio" name="workspace-view" value={o.value} checked={view === o.value} onChange={() => workspaceView.set(o.value)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </span>
    </fieldset>
  );
}

/**
 * Leiste über den Spuren: ohne Song-Ablauf nur ein dezenter Einstieg,
 * mit Song-Ablauf der Umschalter „Spuren | Song“ (+ kompakte Abspielleiste in der Spuren-Ansicht).
 */
export function SongBar({ arr }: { arr: Arrangement | undefined }) {
  const { t } = useT();
  const view = useStore(workspaceView);

  if (!arr) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            createArrangement(8);
            workspaceView.set('song');
          }}
          title={t('ui.song.createHint')}
          className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm text-faint transition-colors hover:bg-hover hover:text-fg"
        >
          <TimelineIcon size={15} />
          {t('ui.song.create')}
        </button>
      </div>
    );
  }

  return (
    <div className="glass relative flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel px-2 py-1.5">
      <ViewSwitch />
      {view === 'tracks' && <SongPlayBar arr={arr} compact />}
    </div>
  );
}
