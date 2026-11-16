import { useStore } from '@nanostores/react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { decodeStrudelInput } from '../../../agents/importer';
import { useT } from '../../../i18n/react';
import { resolvedTracks } from '../../../store/agentBus';
import { importFromFile } from '../hooks/useImportTriggers';
import { cx } from '../lib/cx';
import {
  IMPORT_FILE_ACCEPT,
  analyzeImport,
  applyImport,
  closeImport,
  fileDragActive,
  importDialog,
  isStrudelLink,
  type ImportAnalysis,
  type ImportMode,
} from '../lib/importFlow';
import { modKey } from '../lib/platform';
import { Switch } from '../primitives/Controls';
import { IconButton } from '../primitives/IconButton';
import { CloseIcon, FileIcon, ImportIcon, InfoIcon, LinkIcon, PlusIcon } from '../primitives/Icons';
import { autoplayPref } from '../shared/StartOptions';
import { ImportPreview } from './ImportPreview';

const DEBOUNCE_MS = 250;

type LinkState = 'decoded' | 'invalid' | null;

/** strudel.cc-Link → enthaltener Code (oder Hinweis, dass er nicht lesbar ist). */
function unpackLink(value: string): { text: string; link: LinkState } {
  if (!isStrudelLink(value)) return { text: value, link: null };
  const decoded = decodeStrudelInput(value.trim());
  if (decoded === null) return { text: value, link: 'invalid' };
  return decoded.trim() !== value.trim() ? { text: decoded, link: 'decoded' } : { text: value, link: null };
}

/**
 * Import-Dialog: Code einfügen (oder Datei/strudel.cc-Link), Live-Vorschau des
 * Ergebnisses, dann „Als neues Projekt öffnen“ oder „Zum Projekt hinzufügen“.
 * Basiert auf <dialog> (Fokusfalle & Esc gratis); Zustand in lib/importFlow.
 */
export function ImportDialog() {
  const { t } = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const state = useStore(importDialog);
  const dragging = useStore(fileDragActive);
  const autoplay = useStore(autoplayPref);
  const hasProject = useStore(resolvedTracks).length > 0;
  const ids = { title: useId(), desc: useId(), code: useId(), codeHint: useId(), preview: useId() };

  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [link, setLink] = useState<LinkState>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  /** Neuer Text von außen (Einfügen-Erkennung, Datei, Start) → übernehmen, Vorschau sofort. */
  useEffect(() => {
    const next = unpackLink(state.text);
    setText(next.text);
    setDebounced(next.text);
    setLink(next.link);
    setFileName(state.fileName);
    // nur bei neuem Text von außen (nonce), nicht bei jeder Änderung des Dialog-Zustands
  }, [state.nonce]);

  useEffect(() => {
    if (text === debounced) return;
    const timer = setTimeout(() => setDebounced(text), text.trim() === '' ? 0 : DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, debounced]);

  const analysis = useMemo<ImportAnalysis>(() => analyzeImport(debounced), [debounced]);
  const shown: ImportAnalysis =
    link === 'invalid' ? { status: 'error', message: { key: 'ui.import.error.linkInvalid' }, line: null, column: null } : analysis;
  const stale = text !== debounced;

  // Öffnen/Schließen + Fokus ins Textfeld (Cursor an den Anfang, damit langer Code oben beginnt)
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (state.open && !d.open) {
      d.showModal();
      const ta = textareaRef.current;
      if (ta) {
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(0, 0);
        ta.scrollTop = 0;
      }
    }
    if (!state.open && d.open) d.close();
  }, [state.open]);

  const onChange = (value: string) => {
    const next = unpackLink(value);
    setText(next.text);
    setLink(next.link);
    if (next.link === 'decoded') setDebounced(next.text);
    if (value.trim() === '') setFileName(null);
  };

  /** Aktuelles Ergebnis (bei noch laufender Entprellung frisch berechnet). */
  const current = (): ImportAnalysis => (link === 'invalid' ? shown : stale ? analyzeImport(text) : analysis);
  // Während der Entprellung optimistisch – submit() rechnet ohnehin frisch
  const ready = stale ? text.trim() !== '' && link !== 'invalid' : shown.status === 'ok' && shown.result.stats.tracks > 0;

  const submit = (mode: ImportMode) => {
    const a = current();
    if (a.status !== 'ok' || a.result.stats.tracks === 0) {
      setDebounced(text);
      return;
    }
    // synchron im Klick-Handler → „Direkt abspielen“ zählt als User-Geste
    const added = applyImport(a.result, mode, autoplay);
    const first = added[0];
    if (first) {
      requestAnimationFrame(() => {
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        document
          .querySelector(`[data-node-id="${CSS.escape(first)}"]`)
          ?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
      });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey) {
      e.preventDefault();
      submit('replace');
    }
  };

  /** Markiert die Fehlerstelle im Textfeld. */
  const jumpTo = (line: number, column: number | null) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const lines = text.split('\n');
    const idx = Math.max(0, Math.min(line - 1, lines.length - 1));
    const start = lines.slice(0, idx).reduce((sum, l) => sum + l.length + 1, 0);
    const len = lines[idx]?.length ?? 0;
    const from = column !== null ? start + Math.max(0, Math.min(column - 1, len)) : start;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(from, column !== null ? Math.min(from + 1, start + len) : start + len);
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    ta.scrollTop = Math.max(0, (idx - 3) * lineHeight);
  };

  const summary =
    shown.status === 'ok' && shown.result.stats.tracks > 0
      ? t('ui.import.preview.summary', {
          tracks: t('ui.import.preview.trackCount', { count: shown.result.stats.tracks }),
          blocks: t('ui.import.preview.blockCount', { count: shown.result.stats.blocks }),
          bpm: shown.result.settings.bpm,
        })
      : shown.status === 'error'
        ? t('ui.import.error.title')
        : '';

  const mod = modKey();

  return (
    <dialog
      ref={ref}
      aria-labelledby={ids.title}
      aria-describedby={ids.desc}
      onClose={closeImport}
      onCancel={closeImport}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeImport();
      }}
      className={cx(
        'm-auto w-[min(72rem,calc(100vw-1.5rem))] overflow-hidden rounded-3xl border border-line-strong bg-panel-solid p-0 text-fg shadow-2xl shadow-black/70 backdrop:bg-black/60 open:motion-safe:animate-slide-up',
        'max-h-[min(92dvh,56rem)] lg:h-[min(90dvh,50rem)]',
      )}
    >
      {state.open && (
        <div className="flex max-h-[inherit] flex-col lg:h-full">
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 hidden size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent sm:flex" aria-hidden="true">
                <ImportIcon size={18} />
              </span>
              <div className="min-w-0">
                <h2 id={ids.title} className="text-lg font-semibold">
                  {t('ui.import.title')}
                </h2>
                <p id={ids.desc} className="mt-0.5 text-sm text-muted">
                  {t('ui.import.subtitle')}
                </p>
              </div>
            </div>
            <IconButton label={t('common.close')} onClick={closeImport} tooltip="left" kbd={t('common.keys.esc')}>
              <CloseIcon />
            </IconButton>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:overflow-hidden">
            {/* Eingabe */}
            <div className="flex flex-col gap-2.5 px-5 pt-5 pb-4 sm:px-6 lg:min-h-0 lg:border-r lg:border-line lg:pb-5">
              <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
                <label htmlFor={ids.code} className="text-sm font-medium text-fg">
                  {t('ui.import.codeLabel')}
                </label>
                {link === 'decoded' ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-0.5 text-xs text-muted ring-1 ring-line">
                    <LinkIcon size={12} />
                    {t('ui.import.fromLink')}
                  </span>
                ) : fileName ? (
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-card px-2.5 py-0.5 text-xs text-muted ring-1 ring-line">
                    <FileIcon size={12} className="shrink-0" />
                    <span className="truncate">{t('ui.import.fromFile', { name: fileName })}</span>
                  </span>
                ) : null}
              </div>
              <textarea
                ref={textareaRef}
                id={ids.code}
                value={text}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={onKeyDown}
                aria-describedby={ids.codeHint}
                aria-invalid={shown.status === 'error' ? true : undefined}
                placeholder={t('ui.import.placeholder')}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                wrap="off"
                className={cx(
                  'h-56 w-full resize-none rounded-2xl border bg-canvas/70 px-4 py-3 font-mono text-[13px] leading-5 text-fg transition-colors placeholder:text-faint/70 focus-visible:outline-offset-0 focus-visible:outline-accent/50 sm:h-64 lg:h-auto lg:min-h-0 lg:flex-1',
                  dragging ? 'border-dashed border-accent/80 bg-accent-soft' : 'border-line-strong hover:border-faint/60',
                )}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-card px-3 text-sm text-fg ring-1 ring-line transition-colors hover:bg-raised"
                >
                  <FileIcon size={15} />
                  {t('ui.import.openFile')}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept={IMPORT_FILE_ACCEPT}
                  className="hidden"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void importFromFile(file).then(() => textareaRef.current?.focus({ preventScroll: true }));
                  }}
                />
                {text !== '' && (
                  <button
                    type="button"
                    onClick={() => {
                      onChange('');
                      textareaRef.current?.focus();
                    }}
                    className="flex h-8 items-center rounded-lg px-3 text-sm text-muted transition-colors hover:bg-hover hover:text-fg"
                  >
                    {t('ui.import.clear')}
                  </button>
                )}
                <p id={ids.codeHint} className="ml-auto text-xs text-faint">
                  {t('ui.import.codeHint', { shortcut: `${mod}+Enter` })}
                </p>
              </div>
            </div>

            {/* Vorschau */}
            <section
              aria-labelledby={ids.preview}
              className="flex flex-col gap-3 border-t border-line px-5 pt-4 pb-5 sm:px-6 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:pt-5"
            >
              <div className="flex min-h-6 items-center justify-between gap-2">
                <h3 id={ids.preview} className="text-sm font-medium text-fg">
                  {t('ui.import.previewHeading')}
                </h3>
                {stale && <span className="text-xs text-faint motion-safe:animate-pulse-soft">{t('ui.import.updating')}</span>}
              </div>
              <div className={cx('transition-opacity duration-150', stale && 'opacity-60')}>
                <ImportPreview analysis={shown} code={debounced} onJumpTo={jumpTo} />
              </div>
              <p className="sr-only" aria-live="polite">
                {stale ? '' : summary}
              </p>
            </section>
          </div>

          <footer className="flex flex-col gap-3 border-t border-line bg-panel px-5 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-6">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Switch checked={autoplay} onChange={(v) => autoplayPref.set(v)} label={t('ui.start.autoplay')}>
                <span className="text-muted">{t('ui.start.autoplay')}</span>
              </Switch>
              {hasProject && (
                <p className="flex items-start gap-1.5 text-xs text-faint">
                  <InfoIcon size={13} className="mt-px shrink-0" />
                  {t('ui.import.replaceNotice', { shortcut: `${mod}+Z` })}
                </p>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              {hasProject && (
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() => submit('append')}
                  title={t('ui.import.addToProjectHint')}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-card px-4 text-sm font-medium text-fg ring-1 ring-line-strong transition-colors hover:bg-raised disabled:pointer-events-none disabled:opacity-40"
                >
                  <PlusIcon size={16} />
                  {t('ui.import.addToProject')}
                </button>
              )}
              <button
                type="button"
                disabled={!ready}
                onClick={() => submit('replace')}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40"
              >
                <ImportIcon size={16} />
                {t('ui.import.openAsNew')}
              </button>
            </div>
          </footer>
        </div>
      )}
    </dialog>
  );
}
