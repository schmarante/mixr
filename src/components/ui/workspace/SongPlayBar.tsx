import { useStore } from '@nanostores/react';
import { useT } from '../../../i18n/react';
import { playbackState, projectSettings } from '../../../store/agentBus';
import { setLoopSection, setStartSection } from '../../../store/actions';
import type { Arrangement } from '../../../types/ast';
import { cyclesBefore, formatDuration, sectionName, startIndex, totalCycles, usePlayProgress } from '../lib/arrangement';
import { cx } from '../lib/cx';
import { requestPlay, requestStop } from '../lib/transport';
import { IconButton } from '../primitives/IconButton';
import { PlayIcon, RepeatIcon, ResetIcon } from '../primitives/Icons';

/**
 * Strudel kann nicht springen (der Scheduler startet bei Zyklus 0) – nach einem neuen
 * Startabschnitt wird die Wiedergabe neu gestartet. Synchron im Klick (User-Geste).
 */
function restart(): void {
  if (playbackState.get().isPlaying) requestStop();
  requestPlay();
}

/**
 * Abspielleiste des Songs: Abschnitte als Segmente (Klick = ab hier spielen), Fortschritt
 * im aktuellen Abschnitt, Position im Song, „Von vorn“ und Schleife für den aktuellen
 * Abschnitt. `compact` = einzeilig für die Spuren-Ansicht.
 */
export function SongPlayBar({ arr, compact = false }: { arr: Arrangement; compact?: boolean }) {
  const { t } = useT();
  const bpm = useStore(projectSettings).bpm;
  const isPlaying = useStore(playbackState).isPlaying;
  const progress = usePlayProgress(arr);
  const sections = arr.sections;
  if (sections.length === 0) return null;

  const playing = progress.index >= 0;
  const loopIndex = arr.loopSection ? sections.findIndex((s) => s.id === arr.loopSection) : -1;
  const start = startIndex(arr);
  // Ohne Wiedergabe: der Abschnitt, mit dem es losgehen würde
  const current = playing ? progress.index : loopIndex >= 0 ? loopIndex : start;
  const section = sections[current]!;
  const name = sectionName(section, current);
  const frac = playing ? progress.frac : 0;
  const barInSection = Math.min(section.cycles, Math.floor(frac * section.cycles) + 1);
  const total = totalCycles(arr);
  const songCycle = cyclesBefore(arr, current) + frac * section.cycles;
  const looping = loopIndex >= 0;

  const playFrom = (i: number) => {
    const s = sections[i]!;
    // Mit Schleife wandert die Schleife mit, sonst wird es der neue Startabschnitt
    if (looping) setLoopSection(s.id);
    else setStartSection(i === 0 ? null : s.id);
    restart();
  };

  const fromStart = () => {
    setStartSection(null);
    if (looping) setLoopSection(null);
    restart();
  };

  const segments = (
    <div className={cx('flex min-w-0 flex-1 gap-1', compact ? 'h-8' : 'h-9')} role="group" aria-label={t('ui.songBar.sections')}>
      {sections.map((s, i) => {
        const isCurrent = i === current;
        const isStart = !looping && i === start && start > 0;
        const dimmed = looping && i !== loopIndex;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => playFrom(i)}
            aria-current={isCurrent ? 'true' : undefined}
            aria-label={t('ui.songBar.playFrom', { name: sectionName(s, i) })}
            title={`${sectionName(s, i)} · ${t('ui.song.bars', { count: s.cycles })}`}
            className={cx(
              'relative flex min-w-0 items-center gap-1 overflow-hidden rounded-md px-1.5 text-left text-[11px] leading-none ring-1 ring-inset transition-colors',
              isCurrent
                ? looping
                  ? 'bg-accent-soft font-semibold text-accent ring-accent/60'
                  : 'bg-raised font-semibold text-fg ring-fg/40'
                : 'bg-raised/60 text-muted ring-white/[0.06] hover:bg-hover hover:text-fg',
              dimmed && 'opacity-45',
            )}
            style={{ flexGrow: s.cycles, flexBasis: 0 }}
          >
            {isCurrent && playing && (
              <span
                aria-hidden="true"
                className={cx('absolute inset-y-0 left-0', looping ? 'bg-accent/25' : 'bg-fg/15')}
                style={{ width: `${frac * 100}%` }}
              />
            )}
            {isStart && <PlayIcon size={9} className="relative shrink-0 text-accent" aria-hidden="true" />}
            <span className="relative truncate">{sectionName(s, i)}</span>
          </button>
        );
      })}
    </div>
  );

  const fromStartButton = (
    <IconButton label={t('ui.songBar.fromStart')} size="sm" tooltip="bottom" onClick={fromStart} disabled={!isPlaying && start === 0 && !looping}>
      <ResetIcon size={15} />
    </IconButton>
  );

  const loopButton = (
    <IconButton
      label={looping ? t('ui.song.loopOff') : t('ui.song.loopOn', { name })}
      size="sm"
      variant="toggle"
      pressed={looping}
      tooltip="left"
      onClick={() => setLoopSection(looping ? null : section.id)}
    >
      <RepeatIcon size={15} />
    </IconButton>
  );

  const status = (
    <span className="block min-w-0 truncate text-xs text-muted tabular-nums">
      <span className="font-semibold text-fg">{name}</span> · {t('ui.songBar.barOf', { bar: barInSection, total: section.cycles })}
    </span>
  );

  if (compact) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2" role="region" aria-label={t('ui.songBar.label')}>
        {fromStartButton}
        {segments}
        <span className="hidden max-w-56 min-w-0 shrink lg:block">{status}</span>
        {loopButton}
      </div>
    );
  }

  return (
    <div className="glass relative flex flex-col gap-2 rounded-2xl border border-line bg-panel px-3 py-2.5" role="region" aria-label={t('ui.songBar.label')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {fromStartButton}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {status}
          <span className="hidden h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-white/[0.08] sm:block" aria-hidden="true">
            <span className={cx('block h-full rounded-full', looping ? 'bg-accent' : 'bg-fg/70')} style={{ width: `${frac * 100}%` }} />
          </span>
        </div>
        <span className="text-xs text-faint tabular-nums">
          {t('ui.songBar.position', {
            bar: Math.min(total, Math.floor(songCycle) + 1),
            total,
            time: formatDuration(songCycle, bpm),
            duration: formatDuration(total, bpm),
          })}
        </span>
        {loopButton}
      </div>
      {segments}
    </div>
  );
}
