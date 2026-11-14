import { Fragment, useEffect, useState } from 'react';
import { TRACK_COLORS, getBlockDef } from '../../../blocks/catalog';
import { blockLabel } from '../../../blocks/text';
import { useT } from '../../../i18n/react';
import { duplicateTrack, removeTrack, selectNode, updateTrack } from '../../../store/actions';
import type { ResolvedTrack } from '../../../types/ast';
import { cx } from '../lib/cx';
import { formatPercent } from '../lib/params';
import { TRACK_COLOR_CLASSES, TRACK_COLOR_LABEL_KEYS, trackColor } from '../lib/trackColors';
import { Switch } from '../primitives/Controls';
import { ChevronRightIcon, DuplicateIcon, TrashIcon, VolumeIcon } from '../primitives/Icons';
import { Slider } from '../primitives/Slider';

/** Spur-Einstellungen: Name, Farbe, Lautstärke, Stumm/Solo, Kettenübersicht. */
export function TrackInspector({ rt }: { rt: ResolvedTrack }) {
  const { t } = useT();
  const { track, chain } = rt;
  const p = track.params;
  const color = trackColor(p.color);
  const [name, setName] = useState(p.name);

  useEffect(() => setName(p.name), [p.name]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={cx('size-11 shrink-0 rounded-xl', color.solid)} aria-hidden="true" />
          <div>
            <h2 className="text-lg font-semibold text-fg">{t('ui.trackInspector.title', { name: p.name })}</h2>
            <p className="text-sm text-muted">{t('ui.trackInspector.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              const id = duplicateTrack(track.id);
              if (id) selectNode(id);
            }}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted transition-colors hover:bg-hover hover:text-fg"
          >
            <DuplicateIcon size={15} /> {t('ui.trackInspector.duplicate')}
          </button>
          <button
            type="button"
            onClick={() => removeTrack(track.id)}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted transition-colors hover:bg-danger-soft hover:text-danger"
          >
            <TrashIcon size={15} /> {t('ui.trackInspector.delete')}
          </button>
        </div>
      </header>

      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="track-name" className="text-sm font-medium text-fg">
            {t('ui.trackInspector.name')}
          </label>
          <input
            id="track-name"
            value={name}
            maxLength={40}
            onChange={(e) => {
              setName(e.target.value);
              if (e.target.value.trim()) updateTrack(track.id, { name: e.target.value }, true);
            }}
            onBlur={() => setName(p.name)}
            className="h-9 rounded-xl border border-line-strong bg-canvas px-3 text-sm text-fg transition-colors hover:border-faint focus:border-accent focus:outline-none"
          />
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium text-fg">{t('ui.trackInspector.color')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {TRACK_COLORS.map((c) => (
              <label key={c} title={t(TRACK_COLOR_LABEL_KEYS[c])} className="relative cursor-pointer">
                <input
                  type="radio"
                  name="track-color"
                  value={c}
                  checked={p.color === c}
                  onChange={() => updateTrack(track.id, { color: c })}
                  className="peer sr-only"
                  aria-label={t(TRACK_COLOR_LABEL_KEYS[c])}
                />
                <span
                  className={cx(
                    'block size-7 rounded-full ring-offset-2 ring-offset-panel transition-transform peer-focus-visible:ring-2 peer-focus-visible:ring-accent hover:scale-110',
                    TRACK_COLOR_CLASSES[c].solid,
                    p.color === c && 'ring-2 ring-fg',
                  )}
                />
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <div className="flex min-h-7 items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
              <VolumeIcon size={15} className="text-muted" /> {t('ui.trackInspector.volume')}
            </span>
            <span className="font-mono text-xs text-muted tabular-nums">{formatPercent(p.volume)}</span>
          </div>
          <Slider
            label={t('ui.trackInspector.volume')}
            value={p.volume}
            min={0}
            max={1}
            step={0.01}
            valueText={formatPercent(p.volume)}
            fillClass={color.solid}
            onChange={(v, c) => updateTrack(track.id, { volume: v }, c)}
            onReset={() => updateTrack(track.id, { volume: 0.8 })}
          />
        </div>

        <div className="flex flex-col gap-3 pt-1">
          <Switch checked={p.muted} onChange={(v) => updateTrack(track.id, { muted: v })} label={t('ui.trackInspector.mute')}>
            <span>{t('ui.trackInspector.mute')}</span>
          </Switch>
          <Switch checked={p.solo} onChange={(v) => updateTrack(track.id, { solo: v })} label={t('ui.trackInspector.solo')}>
            <span>
              {t('ui.trackInspector.solo')} <span className="text-xs text-faint">{t('ui.trackInspector.soloHint')}</span>
            </span>
          </Switch>
        </div>
      </div>

      {chain.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-fg">{t('ui.trackInspector.signalChain')}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {chain.map((b, i) => {
              const d = getBlockDef(b.type);
              return (
                <Fragment key={b.id}>
                  {i > 0 && <ChevronRightIcon size={14} className="text-faint" />}
                  <button
                    type="button"
                    onClick={() => selectNode(b.id)}
                    className={cx(
                      'flex h-8 items-center gap-1.5 rounded-lg bg-card px-2.5 text-sm text-fg ring-1 ring-line transition-colors hover:bg-raised',
                      b.bypassed && 'opacity-50',
                    )}
                  >
                    <span aria-hidden="true">{d.icon}</span>
                    {blockLabel(b.type)}
                  </button>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
