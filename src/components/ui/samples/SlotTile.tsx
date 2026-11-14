import { useStore } from '@nanostores/react';
import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../../i18n/react';
import type { UserSampleSlot } from '../../../types/ast';
import { removeSampleFile, removeSlot, renameSlot, sampleBlobs, sampleRef } from '../../../store/userSamples';
import { previewing, togglePreview, waveformPeaks } from '../lib/audioPreview';
import { cx } from '../lib/cx';
import { dropSlotId, filesFromInput, handleIncomingFiles } from '../lib/projectFiles';
import { IconButton } from '../primitives/IconButton';
import { CloseIcon, PlayIcon, PlusIcon, StopIcon, TrashIcon, WarningIcon } from '../primitives/Icons';

const BINS = 48;

/** Mini-Wellenform der ersten (bzw. gewählten) Datei. */
function Waveform({ fileId, present }: { fileId: string | undefined; present: boolean }) {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    let alive = true;
    setPeaks(null);
    if (fileId && present) void waveformPeaks(fileId, BINS).then((p) => alive && setPeaks(p));
    return () => {
      alive = false;
    };
  }, [fileId, present]);
  return (
    <span className="flex h-10 items-center gap-px" aria-hidden="true">
      {Array.from({ length: BINS }, (_, i) => (
        <span
          key={i}
          className={cx('min-w-0 flex-1 rounded-full', peaks ? 'bg-accent/80' : 'bg-white/[0.07]')}
          style={{ height: `${Math.max(6, (peaks?.[i] ?? 0.15) * 100)}%` }}
        />
      ))}
    </span>
  );
}

/**
 * Kachel eines Sample-Slots (Shadertoy-artig): Name (inline umbenennbar), Wellenform,
 * Varianten zum Vorhören, Löschen, Drop-Zone (Dateien landen in diesem Slot).
 */
export function SlotTile({ slot }: { slot: UserSampleSlot }) {
  const { t } = useT();
  const present = useStore(sampleBlobs);
  const playing = useStore(previewing);
  const over = useStore(dropSlotId) === slot.id;
  const [name, setName] = useState(slot.name);
  const [selected, setSelected] = useState(0);
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setName(slot.name), [slot.name]);
  const missing = slot.files.filter((f) => !present[f.id]);
  const sel = slot.files[Math.min(selected, slot.files.length - 1)];

  return (
    <li
      data-slot-id={slot.id}
      className={cx(
        'flex min-w-0 flex-col gap-2.5 rounded-2xl border bg-card p-3.5 transition-colors',
        over ? 'border-dashed border-accent bg-accent-soft' : missing.length > 0 ? 'border-warn/40' : 'border-line',
      )}
    >
      <div className="flex items-center gap-1.5">
        <label htmlFor={inputId} className="sr-only">
          {t('ui.samples.nameLabel')}
        </label>
        <input
          id={inputId}
          value={name}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          onBlur={(e) => setName(renameSlot(slot.id, e.currentTarget.value) ?? slot.name)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              e.stopPropagation();
              setName(slot.name);
            }
          }}
          className="h-8 min-w-0 flex-1 rounded-lg bg-transparent px-1.5 font-mono text-sm font-semibold text-fg ring-1 ring-transparent transition-colors hover:ring-line focus:bg-canvas focus:ring-accent focus:outline-none"
        />
        <IconButton label={t('ui.samples.removeSlot', { name: slot.name })} size="sm" variant="danger" tooltip="left" onClick={() => removeSlot(slot.id)}>
          <TrashIcon size={15} />
        </IconButton>
      </div>

      <Waveform fileId={sel?.id} present={sel ? present[sel.id] === true : false} />

      {slot.files.length === 0 ? (
        <p className="text-xs text-faint">{t('ui.samples.emptySlot')}</p>
      ) : (
        <ul className="flex flex-wrap gap-1" aria-label={t('ui.samples.variants', { count: slot.files.length })}>
          {slot.files.map((f, i) => {
            const ok = present[f.id] === true;
            const isPlaying = playing === f.id;
            return (
              <li key={f.id} className="group/var relative">
                <button
                  type="button"
                  disabled={!ok}
                  onClick={() => {
                    setSelected(i);
                    void togglePreview(f.id);
                  }}
                  aria-label={t(ok ? 'ui.samples.preview' : 'ui.samples.missingFile', { ref: sampleRef(slot.name, i), file: f.fileName })}
                  title={`${sampleRef(slot.name, i)} – ${f.fileName}`}
                  className={cx(
                    'flex h-7 items-center gap-1 rounded-lg px-2 font-mono text-[11px] ring-1 transition-colors',
                    !ok ? 'text-warn ring-warn/40' : isPlaying ? 'bg-accent text-on-accent ring-accent' : i === selected ? 'bg-raised text-fg ring-line-strong' : 'text-muted ring-line hover:bg-hover hover:text-fg',
                  )}
                >
                  {!ok ? <WarningIcon size={11} /> : isPlaying ? <StopIcon size={10} /> : <PlayIcon size={10} />}:{i}
                </button>
                <button
                  type="button"
                  onClick={() => removeSampleFile(slot.id, f.id)}
                  aria-label={t('ui.samples.removeFile', { file: f.fileName })}
                  className="absolute -top-1.5 -right-1.5 hidden size-4 items-center justify-center rounded-full bg-raised text-muted ring-1 ring-line group-focus-within/var:flex group-hover/var:flex hover:text-danger"
                >
                  <CloseIcon size={10} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {missing.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-warn">
          <WarningIcon size={13} className="mt-px shrink-0" />
          {t('ui.samples.missing', { count: missing.length, file: missing[0]!.fileName })}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-0.5">
        <code className="truncate font-mono text-[11px] text-code-string">s("{slot.name}")</code>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-xs text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <PlusIcon size={13} />
          {t('ui.samples.addVariant')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const files = filesFromInput(e.target.files);
            e.target.value = '';
            void handleIncomingFiles(files, slot.id);
          }}
        />
      </div>
    </li>
  );
}
