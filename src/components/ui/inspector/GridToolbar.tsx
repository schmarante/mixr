import { useT } from '../../../i18n/react';
import { TrashIcon } from '../primitives/Icons';

/** Kopfzeile über einem Raster: Titel, Hilfetext, „Leeren“. */
export function GridToolbar({ title, hint, onClear }: { title: string; hint: string; onClear?: (() => void) | undefined }) {
  const { t } = useT();
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
        <span className="text-sm font-medium text-fg">{title}</span>
        <span className="text-xs text-faint">{hint}</span>
      </div>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <TrashIcon size={13} />
          {t('ui.grid.clear')}
        </button>
      )}
    </div>
  );
}
