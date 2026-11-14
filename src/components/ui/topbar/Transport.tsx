import { useStore } from '@nanostores/react';
import { useT } from '../../../i18n/react';
import { compileState, playbackState, resolvedTracks, uiState } from '../../../store/agentBus';
import { cx } from '../lib/cx';
import { togglePlayback } from '../lib/transport';
import { PeerTooltip } from '../primitives/IconButton';
import { PlayIcon, StopIcon, WarningIcon } from '../primitives/Icons';
import { usePlayheadStep } from '../hooks/usePlayhead';

/** Großer Play/Stop-Button – das zentrale Bedienelement. */
export function PlayButton() {
  const { t } = useT();
  const { isPlaying, status } = useStore(playbackState);
  const hasTracks = useStore(resolvedTracks).length > 0;
  const loading = status === 'loading';
  const disabled = !isPlaying && !hasTracks;
  const label = isPlaying ? t('ui.transport.stop') : disabled ? t('ui.transport.addTrackFirst') : t('ui.transport.play');

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={togglePlayback /* synchron → gültige User-Geste */}
        disabled={disabled}
        aria-label={label}
        aria-pressed={isPlaying}
        className={cx(
          'peer relative inline-flex size-11 items-center justify-center rounded-full transition-all duration-150',
          'disabled:cursor-not-allowed disabled:opacity-40',
          isPlaying
            ? 'bg-fg text-canvas hover:bg-white'
            : 'bg-accent text-on-accent shadow-[0_0_0_4px_rgb(255_138_76/0.15)] hover:bg-accent-hover enabled:hover:scale-105',
        )}
      >
        {isPlaying ? <StopIcon size={18} /> : <PlayIcon size={20} className="translate-x-px" />}
        {loading && (
          <span
            aria-hidden="true"
            className="absolute -inset-1 rounded-full border-2 border-accent/30 border-t-accent motion-safe:animate-spin"
          />
        )}
      </button>
      <PeerTooltip text={label} kbd={disabled ? undefined : t('common.keys.space')} />
    </span>
  );
}

/** Vier Punkte, die im Takt mitlaufen – zeigt, dass gerade etwas spielt. */
export function BeatDots() {
  const beat = usePlayheadStep(4);
  return (
    <span className="hidden items-center gap-1 md:flex" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={cx(
            'size-1.5 rounded-full transition-colors duration-75',
            beat === i ? (i === 0 ? 'bg-accent' : 'bg-fg') : 'bg-raised',
          )}
        />
      ))}
    </span>
  );
}

/** Dezenter Engine-Status: „Lade Sounds…“ bzw. ruhiger Hinweis bei Problemen. */
export function EngineStatus() {
  const { t } = useT();
  const { status, error } = useStore(playbackState);
  const diagnostics = useStore(compileState).diagnostics;

  if (status === 'loading') {
    return (
      <span role="status" className="flex items-center gap-2 text-xs text-muted">
        <span className="size-1.5 rounded-full bg-accent motion-safe:animate-pulse-soft" aria-hidden="true" />
        {/* auf schmalen Bildschirmen reicht der Ladekreis am Play-Button */}
        <span className="sr-only md:not-sr-only">{t('ui.transport.loadingSounds')}</span>
      </span>
    );
  }

  const problems = diagnostics.length + (error || status === 'error' ? 1 : 0);
  if (problems === 0) return <span role="status" className="sr-only" />;

  const text = error ?? (status === 'error' ? t('ui.transport.engineFailed') : diagnostics[0]?.message ?? '');
  return (
    <span role="status" className="relative inline-flex">
      <button
        type="button"
        onClick={() => uiState.setKey('codePanelOpen', true)}
        className="peer flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-xs font-medium text-warn transition-colors hover:bg-warn/20"
      >
        <WarningIcon size={13} />
        <span className="hidden sm:inline">{t('ui.transport.notices', { count: problems })}</span>
      </button>
      <PeerTooltip text={text.length > 70 ? `${text.slice(0, 69)}…` : text} />
    </span>
  );
}
