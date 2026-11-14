import { useStore } from '@nanostores/react';
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useT } from '../../../i18n/react';
import { resolvedTracks } from '../../../store/agentBus';
import { ImportPreview } from '../import/ImportPreview';
import { applyPendingMidi, audibleTrackCount, downloadMidi, midiExportOpen, pendingMidi, suggestBars } from '../lib/midiFlow';
import { modKey } from '../lib/platform';
import { Switch } from '../primitives/Controls';
import { IconButton } from '../primitives/IconButton';
import { CheckIcon, CloseIcon, DownloadIcon, ImportIcon, InfoIcon, MidiIcon, PlusIcon, WarningIcon } from '../primitives/Icons';
import { autoplayPref } from '../shared/StartOptions';

/** Modaler Dialog im Stil der Projekt-/Import-Dialoge (öffnet/schließt über `open`). */
function Dialog({
  open,
  onClose,
  labelledBy,
  initialFocus,
  wide,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  initialFocus?: RefObject<HTMLElement | null>;
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      initialFocus?.current?.focus();
    }
    if (!open && d.open) d.close();
  }, [open, initialFocus]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={`m-auto max-h-[min(88dvh,46rem)] ${wide ? 'w-[min(40rem,calc(100vw-1.5rem))]' : 'w-[min(32rem,calc(100vw-1.5rem))]'} overflow-hidden rounded-3xl border border-line-strong bg-panel p-0 text-fg shadow-2xl shadow-black/70 backdrop:bg-black/60 open:motion-safe:animate-slide-up`}
    >
      {open && <div className="flex max-h-[inherit] flex-col">{children}</div>}
    </dialog>
  );
}

function Header({ id, title, subtitle, onClose }: { id: string; title: string; subtitle?: string; onClose: () => void }) {
  const { t } = useT();
  return (
    <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent" aria-hidden="true">
          <MidiIcon size={19} />
        </span>
        <div className="min-w-0">
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 truncate text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      <IconButton label={t('common.close')} onClick={onClose} tooltip="left" kbd={t('common.keys.esc')}>
        <CloseIcon />
      </IconButton>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

/** Vorschau einer MIDI-Datei: Tempo, Spuren mit Bausteinen, Hinweise → öffnen oder hinzufügen. */
export function MidiImportDialog() {
  const { t } = useT();
  const pending = useStore(pendingMidi);
  const autoplay = useStore(autoplayPref);
  const hasProject = useStore(resolvedTracks).length > 0;
  const primaryRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const close = () => pendingMidi.set(null);

  return (
    <Dialog open={pending !== null} onClose={close} labelledBy={titleId} initialFocus={primaryRef} wide>
      {pending && (
        <>
          <Header id={titleId} title={t('midi.ui.importTitle')} subtitle={t('midi.ui.importSubtitle', { name: pending.name })} onClose={close} />
          <div className="min-h-0 overflow-y-auto px-6 py-5">
            <ImportPreview analysis={{ status: 'ok', result: pending.result }} code="" onJumpTo={() => {}} />
          </div>
          <footer className="flex flex-col gap-3 border-t border-line px-6 py-4">
            <div className="flex flex-col gap-1.5">
              <Switch checked={autoplay} onChange={(v) => autoplayPref.set(v)} label={t('ui.start.autoplay')}>
                <span className="text-muted">{t('ui.start.autoplay')}</span>
              </Switch>
              {hasProject && (
                <p className="flex items-start gap-1.5 text-xs text-faint">
                  <InfoIcon size={13} className="mt-px shrink-0" />
                  {t('ui.import.replaceNotice', { shortcut: `${modKey()}+Z` })}
                </p>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {hasProject && (
                <button
                  type="button"
                  onClick={() => applyPendingMidi('append', autoplay)}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-card px-4 text-sm font-medium text-fg ring-1 ring-line-strong transition-colors hover:bg-raised"
                >
                  <PlusIcon size={16} />
                  {t('ui.import.addToProject')}
                </button>
              )}
              <button
                ref={primaryRef}
                type="button"
                onClick={() => applyPendingMidi('replace', autoplay)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover"
              >
                <ImportIcon size={16} />
                {t('ui.import.openAsNew')}
              </button>
            </div>
          </footer>
        </>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

const MAX_BARS = 64;

/** „Als MIDI exportieren“: Länge wählen, Hinweis was exportiert wird, herunterladen. */
export function MidiExportDialog() {
  const { t } = useT();
  const open = useStore(midiExportOpen);
  const [bars, setBars] = useState<number | null>(null);
  const [suggested, setSuggested] = useState<number | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const barsId = useId();
  const hintId = useId();
  const close = () => midiExportOpen.set(false);

  // Beim Öffnen: Vorschlag (Strudel wird dafür nachgeladen) und Spurzahl ermitteln
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setNotes([]);
    setFailed(false);
    setSuggested(null);
    setBars(null);
    void audibleTrackCount().then((c) => !cancelled && setCount(c));
    void suggestBars()
      .then((b) => {
        if (cancelled) return;
        setSuggested(b);
        setBars((cur) => cur ?? b);
      })
      .catch(() => !cancelled && setBars((cur) => cur ?? 8));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const value = bars ?? suggested ?? 8;
  const valid = Number.isInteger(value) && value >= 1 && value <= MAX_BARS;
  const none = count === 0;

  const run = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const hints = await downloadMidi(value);
      setNotes(hints);
      if (hints.length === 0) close();
    } catch (err) {
      console.warn('[midi] export failed', err);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} labelledBy={titleId} initialFocus={inputRef}>
      <Header id={titleId} title={t('midi.ui.exportTitle')} onClose={close} />
      <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-6 py-5">
        <p className="text-sm text-muted">{t('midi.ui.exportIntro')}</p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={barsId} className="text-sm font-medium text-fg">
            {t('midi.ui.barsLabel')}
          </label>
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              id={barsId}
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_BARS}
              step={1}
              value={bars ?? ''}
              placeholder={suggested === null ? '…' : String(suggested)}
              aria-describedby={hintId}
              aria-invalid={!valid}
              onChange={(e) => setBars(e.target.value === '' ? null : Math.round(Number(e.target.value)))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void run();
              }}
              className="h-10 w-24 rounded-xl bg-canvas px-3 text-center font-mono text-base font-semibold text-fg tabular-nums ring-1 ring-line-strong outline-none focus-visible:ring-2 focus-visible:ring-accent aria-[invalid=true]:ring-danger"
            />
            <span className="text-sm text-muted">{t('midi.ui.barsUnit', { count: value })}</span>
          </div>
          <p id={hintId} className="text-xs text-faint" aria-live="polite">
            {suggested === null ? t('midi.ui.barsSuggesting') : t('midi.ui.barsHint', { bars: suggested })}
          </p>
        </div>
        <section aria-labelledby={`${titleId}-what`} className="flex flex-col gap-2 rounded-2xl border border-line bg-card/60 px-4 py-3.5">
          <h3 id={`${titleId}-what`} className="text-xs font-semibold tracking-wide text-faint uppercase">
            {t('midi.ui.whatTitle')}
          </h3>
          <ul className="flex flex-col gap-1.5 text-sm text-muted">
            {count !== null && !none && (
              <li className="flex items-start gap-2">
                <CheckIcon size={15} className="mt-0.5 shrink-0 text-accent" />
                {t('midi.ui.whatTracks', { count })}
              </li>
            )}
            <li className="flex items-start gap-2">
              <CheckIcon size={15} className="mt-0.5 shrink-0 text-accent" />
              {t('midi.ui.whatNotes')}
            </li>
            <li className="flex items-start gap-2">
              <CheckIcon size={15} className="mt-0.5 shrink-0 text-accent" />
              {t('midi.ui.whatDrums')}
            </li>
            <li className="flex items-start gap-2">
              <InfoIcon size={15} className="mt-0.5 shrink-0 text-faint" />
              {t('midi.ui.whatNot')}
            </li>
          </ul>
        </section>
        {(none || failed || notes.length > 0) && (
          <div role="status" className="flex flex-col gap-1.5 rounded-xl bg-warn-soft px-3 py-2.5 text-sm text-fg">
            {none && (
              <p className="flex items-start gap-2">
                <WarningIcon size={15} className="mt-0.5 shrink-0 text-warn" />
                {t('midi.ui.noTracks')}
              </p>
            )}
            {failed && (
              <p className="flex items-start gap-2">
                <WarningIcon size={15} className="mt-0.5 shrink-0 text-warn" />
                {t('midi.ui.toastFailed')}
              </p>
            )}
            {notes.map((n, i) => (
              <p key={i} className="flex items-start gap-2">
                <InfoIcon size={15} className="mt-0.5 shrink-0 text-warn" />
                {n}
              </p>
            ))}
          </div>
        )}
      </div>
      <footer className="flex flex-col-reverse gap-2 border-t border-line px-6 py-4 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={close}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-card px-4 text-sm font-medium text-fg ring-1 ring-line-strong transition-colors hover:bg-raised"
        >
          {t('common.close')}
        </button>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!valid || busy || none}
          aria-busy={busy}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          <DownloadIcon size={16} />
          {busy ? t('midi.ui.exporting') : t('midi.ui.export')}
        </button>
      </footer>
    </Dialog>
  );
}

/** Beide MIDI-Dialoge (in der Topbar-Insel gerendert). */
export function MidiDialogs() {
  return (
    <>
      <MidiImportDialog />
      <MidiExportDialog />
    </>
  );
}
