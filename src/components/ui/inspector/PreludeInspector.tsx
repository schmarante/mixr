import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../../i18n/react';
import { selectNode, setPrelude } from '../../../store/actions';
import { modKey } from '../lib/platform';
import { preludeNames } from '../lib/prelude';
import { requestStop } from '../lib/transport';
import { ExternalIcon, TrashIcon } from '../primitives/Icons';
import { PreludeNameChips } from '../workspace/PreludeCard';

const SAVE_DELAY_MS = 350;

/** Code-Editor (CodeMirror) als eigener Chunk – bis er geladen ist, tut es das Textfeld. */
const StrudelEditor = lazy(() => import('../editor/StrudelEditor'));

/**
 * Inspector für den Setup-Code des Projekts: Code-Editor (wie beim Code-Baustein,
 * entprellt, ein Undo-Schritt pro Tipp-Serie), kurze Erklärung, „Entfernen“.
 * Ein komplett geleertes Feld wird nicht gespeichert (sonst verschwände der Editor
 * beim Tippen) – entfernt wird bewusst über den Button.
 */
export function PreludeInspector({ code }: { code: string }) {
  const { t } = useT();
  const id = useId();
  const hintId = useId();
  const [draft, setDraft] = useState(code);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string | null>(null);

  // Externe Änderungen (Undo, Import) übernehmen, solange nicht getippt wird
  useEffect(() => {
    if (!focused.current) setDraft(code);
  }, [code]);

  const flush = () => {
    clearTimeout(timer.current);
    const text = pending.current;
    pending.current = null;
    if (text !== null && text.trim() !== '') setPrelude(text, true);
  };
  // Beim Verlassen ausstehende Eingabe noch speichern
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (pending.current !== null && pending.current.trim() !== '') setPrelude(pending.current, true);
    },
    [],
  );

  const change = (text: string) => {
    setDraft(text);
    pending.current = text;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  };

  const leave = () => {
    focused.current = false;
    flush();
    // Leer verlassen → gespeicherten Stand wieder anzeigen
    if (draft.trim() === '') setDraft(code);
  };

  const textarea = (
    <textarea
      id={id}
      value={draft}
      aria-describedby={hintId}
      rows={6}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      autoComplete="off"
      wrap="off"
      onFocus={() => (focused.current = true)}
      onBlur={leave}
      onChange={(e) => change(e.target.value)}
      className="field-sizing-content max-h-80 min-h-28 w-full resize-y rounded-xl border border-line-strong bg-canvas px-3 py-2 font-mono text-[13px] leading-relaxed text-fg transition-colors hover:border-faint focus:border-accent focus:outline-none"
    />
  );

  const remove = () => {
    clearTimeout(timer.current);
    pending.current = null;
    setPrelude('');
    selectNode(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-raised text-2xl" aria-hidden="true">
            ⌨️
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-fg">{t('ui.prelude.title')}</h2>
            <p id={hintId} className="text-sm text-muted">
              {t('ui.prelude.explain')}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={remove}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted transition-colors hover:bg-danger-soft hover:text-danger"
          >
            <TrashIcon size={15} /> {t('ui.prelude.remove')}
          </button>
          <span className="text-xs text-faint">{t('ui.prelude.removeHint', { shortcut: `${modKey()}+Z` })}</span>
        </div>
      </header>

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={id} className="text-sm font-medium text-fg">
            {t('ui.prelude.editorLabel')}
          </label>
          <a
            href="https://strudel.cc/workshop/getting-started/"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-faint transition-colors hover:bg-hover hover:text-fg"
            title={t('ui.fields.syntaxTooltip', { name: t('ui.fields.syntaxCode') })}
          >
            {t('ui.fields.syntaxCode')}
            <ExternalIcon size={11} />
          </a>
        </div>
        <Suspense fallback={textarea}>
          <StrudelEditor
            id={id}
            variant="compact"
            value={draft}
            ariaLabel={t('ui.prelude.editorLabel')}
            ariaDescribedBy={hintId}
            onFocus={() => (focused.current = true)}
            onBlur={leave}
            onCommit={flush}
            onStop={requestStop}
            onChange={change}
            className="[&_.cm-content]:min-h-28"
          />
        </Suspense>
        {draft.trim() === '' ? (
          <p className="text-xs text-faint">{t('ui.prelude.emptyHint')}</p>
        ) : (
          <PreludeNameChips names={preludeNames(draft)} />
        )}
      </div>
    </div>
  );
}
