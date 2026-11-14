import { useStore } from '@nanostores/react';
import { useEffect, useRef } from 'react';
import { useT } from '../../../i18n/react';
import { resolvedTracks } from '../../../store/agentBus';
import { modKey } from '../lib/platform';
import { StartOptions } from '../shared/StartOptions';
import { IconButton } from '../primitives/IconButton';
import { CloseIcon, InfoIcon } from '../primitives/Icons';

/** Modaler Dialog „Neu / Vorlagen“ auf Basis von <dialog> (Fokusfalle & Esc gratis). */
export function TemplatesDialog({ open, onClose, title }: { open: boolean; onClose: () => void; title: string }) {
  const { t } = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const hasProject = useStore(resolvedTracks).length > 0;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="templates-title"
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-auto max-h-[min(88dvh,52rem)] w-[min(60rem,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-line-strong bg-panel p-0 text-fg shadow-2xl shadow-black/70 backdrop:bg-black/60 open:motion-safe:animate-slide-up"
    >
      {open && (
        <div className="flex max-h-[inherit] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
            <div>
              <h2 id="templates-title" className="text-lg font-semibold">
                {title}
              </h2>
              {hasProject && (
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                  <InfoIcon size={15} className="shrink-0 text-faint" />
                  {t('ui.templatesDialog.replaceNotice', { shortcut: `${modKey()}+Z` })}
                </p>
              )}
            </div>
            <IconButton label={t('common.close')} onClick={onClose} tooltip="left" kbd={t('common.keys.esc')}>
              <CloseIcon />
            </IconButton>
          </header>
          <div className="min-h-0 overflow-y-auto px-6 py-6">
            <StartOptions onDone={onClose} compact />
          </div>
        </div>
      )}
    </dialog>
  );
}
