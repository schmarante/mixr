import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../../i18n/react';
import { dismissToast, toast, undoFromToast } from '../lib/importFlow';
import { modKey } from '../lib/platform';
import { IconButton } from '../primitives/IconButton';
import { CheckIcon, CloseIcon, UndoIcon } from '../primitives/Icons';

const VISIBLE_MS = 6000;

/**
 * Dezente Bestätigung unten in der Mitte (z. B. nach einem Import), optional mit
 * „Rückgängig“. Verschwindet von selbst – nicht, solange Maus oder Fokus darauf liegen.
 * Die Live-Region existiert immer, damit Screenreader neue Meldungen ansagen.
 */
export function Toast() {
  const { t } = useT();
  const current = useStore(toast);
  const [paused, setPaused] = useState(false);

  // Neue Meldung → Pause zurücksetzen (mouseleave feuert nicht, wenn die alte verschwindet)
  const currentId = current?.id;
  useEffect(() => setPaused(false), [currentId]);

  useEffect(() => {
    if (!current || paused) return;
    const timer = setTimeout(dismissToast, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [current, paused]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:bottom-6"
    >
      {current && (
        <div
          key={current.id}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
          className="pointer-events-auto flex max-w-full items-center gap-3 rounded-2xl border border-line-strong bg-raised-solid py-2 pr-2 pl-3.5 text-sm text-fg shadow-2xl shadow-black/60 motion-safe:animate-slide-up"
        >
          <CheckIcon size={16} className="shrink-0 text-ok" />
          <span className="min-w-0">{current.text}</span>
          {current.undo && (
            <button
              type="button"
              onClick={undoFromToast}
              title={`${t('ui.topbar.undo')} (${modKey()}+Z)`}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 font-medium text-muted transition-colors hover:bg-hover hover:text-fg"
            >
              <UndoIcon size={15} />
              {t('ui.topbar.undo')}
            </button>
          )}
          <IconButton label={t('common.close')} size="xs" tooltip={false} onClick={dismissToast}>
            <CloseIcon size={14} />
          </IconButton>
        </div>
      )}
    </div>,
    document.body,
  );
}
