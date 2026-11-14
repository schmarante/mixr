import { useStore } from '@nanostores/react';
import { useEffect, useRef } from 'react';
import { useT } from '../../../i18n/react';
import { sampleSlots } from '../../../store/userSamples';
import { stopPreview } from '../lib/audioPreview';
import { cx } from '../lib/cx';
import { fileDragActive } from '../lib/importFlow';
import { downloadProject, dropSlotId, filesFromInput, handleIncomingFiles, samplesDialogOpen } from '../lib/projectFiles';
import { IconButton } from '../primitives/IconButton';
import { CloseIcon, FileIcon, ImportIcon, InfoIcon, PlusIcon } from '../primitives/Icons';
import { SlotTile } from './SlotTile';

/**
 * „Samples“-Panel: eigene Klänge als Slots (Kacheln), Dateien oder Ordner per
 * Drag & Drop bzw. Auswahl, Projekt-Download als ZIP. Basiert auf <dialog>.
 */
export function SamplesDialog() {
  const { t } = useT();
  const open = useStore(samplesDialogOpen);
  const slots = useStore(sampleSlots);
  const dragging = useStore(fileDragActive);
  const overNew = useStore(dropSlotId) === 'new';
  const ref = useRef<HTMLDialogElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (!open) stopPreview();
  }, [open]);

  // Ordner-Auswahl: nicht-standardisiertes Attribut setzen (React kennt es nicht typisiert)
  useEffect(() => {
    folderRef.current?.setAttribute('webkitdirectory', '');
  }, [open]);

  const close = () => samplesDialogOpen.set(false);

  return (
    <dialog
      ref={ref}
      aria-labelledby="samples-title"
      aria-describedby="samples-desc"
      onClose={close}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="m-auto max-h-[min(90dvh,54rem)] w-[min(64rem,calc(100vw-1.5rem))] overflow-hidden rounded-3xl border border-line-strong bg-panel p-0 text-fg shadow-2xl shadow-black/70 backdrop:bg-black/60 open:motion-safe:animate-slide-up"
    >
      {open && (
        <div className="flex max-h-[inherit] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6 sm:py-5">
            <div className="min-w-0">
              <h2 id="samples-title" className="text-lg font-semibold">
                {t('ui.samples.title')}
              </h2>
              <p id="samples-desc" className="mt-0.5 text-sm text-muted">
                {t('ui.samples.subtitle')}
              </p>
            </div>
            <IconButton label={t('common.close')} onClick={close} tooltip="left" kbd={t('common.keys.esc')}>
              <CloseIcon />
            </IconButton>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('ui.samples.listLabel')}>
              {slots.map((slot) => (
                <SlotTile key={slot.id} slot={slot} />
              ))}
              <li
                data-slot-id="new"
                className={cx(
                  'flex min-h-44 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-4 text-center transition-colors',
                  overNew || (dragging && slots.length === 0) ? 'border-accent bg-accent-soft' : 'border-line-strong',
                )}
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-raised text-muted">
                  <PlusIcon size={18} />
                </span>
                <p className="text-sm font-medium text-fg">{t('ui.samples.dropHere')}</p>
                <p className="max-w-56 text-xs text-muted">{t('ui.samples.dropHint')}</p>
                <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => filesRef.current?.click()}
                    className="flex h-8 items-center gap-1.5 rounded-lg bg-card px-3 text-sm text-fg ring-1 ring-line transition-colors hover:bg-raised"
                  >
                    <FileIcon size={14} />
                    {t('ui.samples.chooseFiles')}
                  </button>
                  <button
                    type="button"
                    onClick={() => folderRef.current?.click()}
                    className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm text-muted transition-colors hover:bg-hover hover:text-fg"
                  >
                    {t('ui.samples.chooseFolder')}
                  </button>
                </div>
                <input
                  ref={filesRef}
                  type="file"
                  multiple
                  accept="audio/*,.zip"
                  className="hidden"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => {
                    const files = filesFromInput(e.target.files);
                    e.target.value = '';
                    void handleIncomingFiles(files);
                  }}
                />
                <input
                  ref={folderRef}
                  type="file"
                  multiple
                  className="hidden"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => {
                    const files = filesFromInput(e.target.files);
                    e.target.value = '';
                    void handleIncomingFiles(files);
                  }}
                />
              </li>
            </ul>
          </div>

          <footer className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="flex items-start gap-1.5 text-xs text-faint">
              <InfoIcon size={13} className="mt-px shrink-0" />
              {t('ui.samples.privacy')}
            </p>
            <button
              type="button"
              onClick={() => void downloadProject()}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl bg-card px-3.5 text-sm font-medium text-fg ring-1 ring-line-strong transition-colors hover:bg-raised"
            >
              <ImportIcon size={15} />
              {t('ui.projectFile.download')}
            </button>
          </footer>
        </div>
      )}
    </dialog>
  );
}
