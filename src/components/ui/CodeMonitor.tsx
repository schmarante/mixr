import { useStore } from '@nanostores/react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { compileState, playbackState, playingCode, resolvedTracks, uiState } from '../../store/agentBus';
import { selectNode } from '../../store/actions';
import { useT } from '../../i18n/react';
import { liveCode } from './editor/liveCode';
import { ensureClientBoot } from './lib/boot';
import { cx } from './lib/cx';
import { rich } from './lib/rich';
import { TOKEN_CLASSES, tokenizeLines } from './lib/highlight';
import { openImport } from './lib/importFlow';
import { modKey } from './lib/platform';
import { strudelUrl } from './lib/strudelLink';
import { requestPlay, requestStop } from './lib/transport';
import { IconButton } from './primitives/IconButton';
import { CheckIcon, CloseIcon, CopyIcon, ExternalIcon, ImportIcon, InfoIcon, ResetIcon, WarningIcon } from './primitives/Icons';

ensureClientBoot();
// Editor ↔ Bausteine ↔ Engine synchron halten (auch bei geschlossenem Panel: Bausteine → Code)
if (typeof window !== 'undefined') liveCode().start();

/** CodeMirror erst laden, wenn das Code-Panel geöffnet wird (eigener Chunk). */
const StrudelEditor = lazy(() => import('./editor/StrudelEditor'));

function useNodeLabel() {
  const { t } = useT();
  const tracks = useStore(resolvedTracks);
  return (id: string): string | null => {
    for (const rt of tracks) {
      if (rt.track.id === id) return t('ui.code.whereTrack', { name: rt.track.params.name });
      if (rt.chain.some((b) => b.id === id)) return t('ui.code.whereIn', { name: rt.track.params.name });
    }
    return null;
  };
}

/** Diagnosen des Compilers und Laufzeitfehler der Engine – ruhig und verständlich. */
function Problems() {
  const { t } = useT();
  const diagnostics = useStore(compileState).diagnostics;
  const { error } = useStore(playbackState);
  const labelOf = useNodeLabel();
  if (diagnostics.length === 0 && !error) return null;

  return (
    <div className="flex flex-col gap-2 border-b border-line px-4 py-3" role="status">
      {error && (
        <div className="flex items-start gap-2.5 rounded-xl bg-danger-soft px-3 py-2.5 text-sm">
          <WarningIcon size={16} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="font-medium text-fg">{t('ui.code.playbackError')}</p>
            <p className="mt-0.5 font-mono text-xs break-words text-muted">{error}</p>
          </div>
        </div>
      )}
      {diagnostics.map((d, i) => {
        const where = d.nodeId ? labelOf(d.nodeId) : null;
        const body = (
          <>
            <WarningIcon size={15} className="mt-0.5 shrink-0 text-warn" />
            <span className="min-w-0 text-left">
              <span className="text-fg">{d.message}</span>
              {where && <span className="ml-1.5 text-xs text-faint">{where}</span>}
            </span>
          </>
        );
        return d.nodeId && where ? (
          <button
            key={i}
            type="button"
            onClick={() => selectNode(d.nodeId)}
            title={t('ui.code.jumpToBlock')}
            className="flex items-start gap-2.5 rounded-xl bg-warn-soft px-3 py-2 text-sm transition-colors hover:bg-warn/20"
          >
            {body}
          </button>
        ) : (
          <div key={i} className="flex items-start gap-2.5 rounded-xl bg-warn-soft px-3 py-2 text-sm">
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** Nur-Lese-Ansicht, solange der Editor (eigener Chunk) lädt. */
function CodeView({ code }: { code: string }) {
  const { t } = useT();
  const lines = useMemo(() => tokenizeLines(code), [code]);
  return (
    <pre className="py-2.5 font-mono text-[13px] leading-[1.6]" aria-label={t('ui.code.codeLabel')}>
      <code>
        {lines.map((line, i) => (
          <div key={i} className="flex">
            <span className="w-10 shrink-0 pr-2 text-right text-faint/50 select-none" aria-hidden="true">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 pr-4 pl-1.5 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {line.length === 0
                ? '​'
                : line.map((tok, j) => (
                    <span key={j} className={TOKEN_CLASSES[tok.kind]}>
                      {tok.text}
                    </span>
                  ))}
            </span>
          </div>
        ))}
      </code>
    </pre>
  );
}

/** Zustand des Live-Codes: synchron / wird angewendet / spielt – plus Tastenkürzel. */
function LiveStatus() {
  const { t } = useT();
  const live = liveCode();
  const { mode, text } = useStore(live.state);
  const { isPlaying } = useStore(playbackState);
  const playing = useStore(playingCode);
  const isLive = isPlaying && playing === text && text.trim() !== '';
  if (mode === 'codeMode') return null;
  const label =
    mode === 'typing' ? t('ui.code.status.typing') :
    mode === 'linked' ? (isPlaying ? t('ui.code.status.linkedPlaying') : t('ui.code.status.linked')) :
    t('ui.code.status.synced');
  const mod = modKey();
  return (
    <div className="flex min-h-9 items-center gap-2 border-b border-line px-4 py-1.5 text-xs" role="status" aria-live="polite">
      <span
        className={cx(
          'size-1.5 shrink-0 rounded-full',
          mode === 'typing' ? 'bg-warn motion-safe:animate-pulse-soft' : mode === 'linked' ? 'bg-accent' : 'bg-ok/80',
        )}
        aria-hidden="true"
      />
      <span className={cx('min-w-0 truncate', mode === 'linked' ? 'text-fg' : 'text-muted')} data-testid="live-status" data-mode={mode}>
        {label}
      </span>
      {isLive && (
        <span
          title={t('ui.code.status.liveTooltip')}
          className="flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent"
          data-testid="live-chip"
        >
          <span className="size-1.5 rounded-full bg-accent motion-safe:animate-pulse-soft" aria-hidden="true" />
          {t('ui.code.status.live')}
        </span>
      )}
      <span className="ml-auto hidden shrink-0 text-faint sm:inline">
        {t('ui.code.shortcuts', { apply: `${mod}+Enter`, stop: `${mod}+.` })}
      </span>
    </div>
  );
}

/** Code-Modus: Der Text spielt, ist aber nicht als Bausteine darstellbar. */
function CodeModeBanner() {
  const { t } = useT();
  const live = liveCode();
  const { mode, reason, syntax, text } = useStore(live.state);
  if (mode !== 'codeMode') return null;
  const detail =
    reason === 'syntax' && syntax?.forText === text ? t('ui.code.codeMode.syntax', { line: syntax.line }) :
    reason === 'runtime' ? null : // die Fehlermeldung selbst steht schon in der Statuszeile
    reason === 'noPattern' ? t('ui.code.codeMode.noPattern') :
    reason === 'arrangement' ? t('ui.code.codeMode.arrangement') :
    t('ui.code.codeMode.error');
  return (
    <div className="flex flex-col gap-2 border-b border-line bg-warn-soft px-4 py-3 text-sm" role="status" data-testid="code-mode">
      {detail && (
        <div className="flex items-start gap-2.5">
          <CodeIconSmall />
          <p className="min-w-0 text-xs leading-snug text-muted">{detail}</p>
        </div>
      )}
      <button
        type="button"
        onClick={() => live.backToBlocks()}
        title={t('ui.code.codeMode.backTooltip')}
        className="ml-6.5 flex h-8 w-fit items-center gap-1.5 rounded-lg bg-card px-3 text-sm text-fg ring-1 ring-line transition-colors hover:bg-raised"
      >
        <ResetIcon size={14} />
        {t('ui.code.codeMode.back')}
      </button>
    </div>
  );
}

function CodeIconSmall() {
  return <WarningIcon size={16} className="mt-0.5 shrink-0 text-warn" />;
}

/** Dezenter Hinweis nach einer automatischen Umstellung (angeglichen / Entwurf ersetzt). */
function LiveNotice() {
  const { t } = useT();
  const live = liveCode();
  const { notice, discarded } = useStore(live.state);
  useEffect(() => {
    if (notice?.kind !== 'aligned') return;
    const timer = setTimeout(() => live.dismissNotice(), 5000);
    return () => clearTimeout(timer);
  }, [notice, live]);
  if (!notice) return null;
  return (
    <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-xs text-muted motion-safe:animate-fade-in" role="status" data-testid="live-notice">
      <InfoIcon size={14} className="shrink-0 text-faint" />
      <span className="min-w-0 flex-1">
        {notice.kind === 'aligned' ? t('ui.code.aligned', { count: notice.substituted }) : t('ui.code.replaced')}
      </span>
      {notice.kind === 'replaced' && discarded !== null && (
        <button type="button" onClick={() => live.restoreDraft()} className="shrink-0 rounded-md px-2 py-1 text-fg underline decoration-accent/60 underline-offset-4 hover:decoration-accent">
          {t('ui.code.restore')}
        </button>
      )}
      <button
        type="button"
        onClick={() => live.dismissNotice()}
        aria-label={t('ui.code.dismiss')}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-fg"
      >
        <CloseIcon size={13} />
      </button>
    </div>
  );
}

/**
 * Code-Monitor-Insel: zeigt den generierten Strudel-Code (mit Highlighting),
 * Kopieren, „In Strudel öffnen“ und Hinweise. Einklappbar über die Topbar.
 */
export default function CodeMonitor() {
  const { t } = useT();
  const open = useStore(uiState).codePanelOpen;
  const live = liveCode();
  const { text: code, syntax } = useStore(live.state);
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (open) closeRef.current?.focus({ preventScroll: true });
  }, [open]);

  if (!open) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Zwischenablage nicht verfügbar (z. B. ohne HTTPS) – Code bleibt markierbar
    }
  };

  const close = () => uiState.setKey('codePanelOpen', false);
  const hasCode = code.trim().length > 0;

  return (
    <>
      {/* Mobile/Tablet: abgedunkelter Hintergrund für das Bottom-Sheet */}
      <button
        type="button"
        aria-label={t('ui.code.closeBackdrop')}
        tabIndex={-1}
        onClick={close}
        className="fixed inset-0 z-30 bg-black/50 lg:hidden motion-safe:animate-fade-in"
      />
      <aside
        id="code-monitor"
        aria-label={t('ui.code.panelLabel')}
        className={cx(
          'glass flex min-h-0 flex-col lg:relative border-line-strong bg-panel motion-safe:animate-fade-in',
          'max-lg:bg-panel-solid max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-40 max-lg:h-[72dvh] max-lg:rounded-t-3xl max-lg:border-t max-lg:shadow-2xl max-lg:shadow-black',
          'lg:w-[26rem] lg:shrink-0 lg:border-l xl:w-[30rem]',
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-fg">{t('ui.code.title')}</h2>
            <p className="text-xs text-muted">{t('ui.code.subtitle')}</p>
          </div>
          <IconButton label={t('common.close')} tooltip="left" buttonRef={closeRef} onClick={close}>
            <CloseIcon />
          </IconButton>
        </header>

        <div className="flex flex-wrap gap-2 border-b border-line px-4 py-2.5">
          <button
            type="button"
            onClick={copy}
            disabled={!hasCode}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-card px-3 text-sm text-fg ring-1 ring-line transition-colors hover:bg-raised disabled:opacity-40"
          >
            {copied ? <CheckIcon size={15} className="text-ok" /> : <CopyIcon size={15} />}
            {copied ? t('ui.code.copied') : t('ui.code.copy')}
          </button>
          <a
            href={hasCode ? strudelUrl(code) : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!hasCode}
            className={cx(
              'flex h-8 items-center gap-1.5 rounded-lg bg-card px-3 text-sm text-fg ring-1 ring-line transition-colors hover:bg-raised',
              !hasCode && 'pointer-events-none opacity-40',
            )}
          >
            <ExternalIcon size={15} />
            {t('ui.code.openInStrudel')}
          </a>
          <button
            type="button"
            onClick={() => openImport()}
            aria-haspopup="dialog"
            title={t('ui.import.tooltip')}
            className="ml-auto flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted transition-colors hover:bg-hover hover:text-fg"
          >
            <ImportIcon size={15} />
            {t('ui.import.codePanel')}
          </button>
        </div>

        <LiveStatus />
        <CodeModeBanner />
        <LiveNotice />
        <Problems />

        {!hasCode && (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-line px-4 py-2.5 text-xs text-muted">
            <span>{t('ui.code.empty')}</span>
            <button
              type="button"
              onClick={() => openImport()}
              aria-haspopup="dialog"
              className="text-fg underline decoration-accent/60 underline-offset-4 hover:decoration-accent"
            >
              {t('ui.import.codePanelEmpty')}
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden bg-canvas/60" data-keep-space>
          <Suspense fallback={<div className="h-full overflow-auto">{hasCode && <CodeView code={code} />}</div>}>
            <StrudelEditor
              variant="panel"
              live
              value={code}
              onChange={(text) => live.edit(text)}
              onFocus={() => live.focus()}
              onBlur={() => live.blur()}
              onCommit={() => {
                live.commit();
                // wie auf strudel.cc: Strg/⌘+Enter startet auch die Wiedergabe (Tastendruck = Nutzergeste)
                if (!playbackState.get().isPlaying && code.trim() !== '') requestPlay();
              }}
              onStop={requestStop}
              error={syntax ? { forText: syntax.forText, start: syntax.start, end: syntax.end } : null}
              ariaLabel={t('ui.code.editorLabel')}
              placeholder={t('ui.code.placeholder')}
            />
          </Suspense>
        </div>

        <footer className="flex items-start gap-2 border-t border-line px-4 py-3 text-xs text-faint">
          <InfoIcon size={14} className="mt-px shrink-0" />
          <span>{rich(t('ui.code.footer'), { example: <code className="font-mono text-code-method">.room()</code> })}</span>
        </footer>
      </aside>
    </>
  );
}
