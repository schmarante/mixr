import { useT } from '../../../i18n/react';
import { selectNode } from '../../../store/actions';
import { cx } from '../lib/cx';
import { PRELUDE_ID, preludeNames, preludePreview } from '../lib/prelude';

const MAX_CHIPS = 5;

/** Kleine Namens-Chips (register('fade' …) → „fade“), bei vielen mit „+N“. */
export function PreludeNameChips({ names }: { names: string[] }) {
  const { t } = useT();
  if (names.length === 0) return null;
  const shown = names.slice(0, MAX_CHIPS);
  const rest = names.length - shown.length;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1" aria-label={t('ui.prelude.namesLabel', { names: names.join(', ') })}>
      {shown.map((n) => (
        <span key={n} aria-hidden="true" className="rounded-md bg-raised px-1.5 py-px font-mono text-[11px] text-code-fn ring-1 ring-line">
          {n}
        </span>
      ))}
      {rest > 0 && (
        <span aria-hidden="true" className="text-[11px] text-faint">
          +{rest}
        </span>
      )}
    </span>
  );
}

/**
 * Ruhige Karte über den Spuren, wenn das Projekt Setup-Code hat (meist aus einem Import).
 * Klick wählt sie aus → Inspector zeigt den Code-Editor.
 */
export function PreludeCard({ code, selected }: { code: string; selected: boolean }) {
  const { t } = useT();
  const names = preludeNames(code);
  const lines = preludePreview(code);

  return (
    <button
      type="button"
      data-node-id={PRELUDE_ID}
      aria-pressed={selected}
      onClick={() => selectNode(selected ? null : PRELUDE_ID)}
      title={t('ui.prelude.cardTooltip')}
      className={cx(
        'group flex w-full min-w-0 items-center gap-3 border bg-panel px-4 py-3 text-left transition-colors duration-150',
        selected ? 'border-accent/50 ring-1 ring-accent/50' : 'border-line hover:border-line-strong hover:bg-card/60',
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-raised text-lg" aria-hidden="true">
        ⌨️
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="text-sm font-semibold text-fg">{t('ui.prelude.title')}</span>
          <PreludeNameChips names={names} />
        </span>
        <span className="flex min-w-0 flex-col font-mono text-xs leading-5 text-muted" aria-hidden="true">
          {lines.map((l, i) => (
            <span key={i} className="truncate whitespace-pre">
              {l}
            </span>
          ))}
        </span>
      </span>
      <span className="hidden shrink-0 text-xs text-faint md:inline">{t('ui.prelude.cardHint')}</span>
    </button>
  );
}
