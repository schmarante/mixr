import { useStore } from '@nanostores/react';
import { useEffect, useMemo } from 'react';
import { compileState, projectSettings, resolvedTracks, uiState, visualAstStore } from '../../store/agentBus';
import { selectNode } from '../../store/actions';
import { useT } from '../../i18n/react';
import { ensureClientBoot } from './lib/boot';
import { dragInfo, dropTarget } from './workspace/dnd';
import { NewTrackBar } from './workspace/NewTrackBar';
import { Onboarding } from './workspace/Onboarding';
import { PreludeCard } from './workspace/PreludeCard';
import { PRELUDE_ID } from './lib/prelude';
import { TrackRow } from './workspace/TrackRow';
import { SongBar } from './workspace/SongBar';
import { SongView } from './workspace/SongView';
import { workspaceView } from './lib/arrangement';

ensureClientBoot();

/**
 * Workspace-Insel: Spuren als Kanalzüge mit horizontaler Bausteinkette.
 * Ohne Spuren → Startbildschirm (Vorlagen + Schnellstart). Mit Setup-Code steht darüber dessen Karte.
 * Mit Song-Ablauf schaltet „Spuren | Song“ zwischen Bausteinen und Zeitleiste um.
 */
export default function NodeWorkspace() {
  const { t } = useT();
  const tracks = useStore(resolvedTracks);
  const selectedId = useStore(uiState).selectedNodeId;
  const drop = useStore(dropTarget);
  const drag = useStore(dragInfo);
  const diagnosticsList = useStore(compileState).diagnostics;
  const prelude = useStore(projectSettings).prelude;
  const arrangement = useStore(visualAstStore).arrangement;
  const view = useStore(workspaceView);

  const diagnostics = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of diagnosticsList) if (d.nodeId && !m.has(d.nodeId)) m.set(d.nodeId, d.message);
    return m;
  }, [diagnosticsList]);

  // Ausgewähltes Element sichtbar halten (z. B. nach Klick in einer Diagnose)
  useEffect(() => {
    if (!selectedId) return;
    const el = document.querySelector(`[data-node-id="${CSS.escape(selectedId)}"]`);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [selectedId]);

  if (tracks.length === 0) {
    return (
      <section aria-label={t('ui.regions.start')} className="min-h-0 flex-1 overflow-y-auto">
        <Onboarding />
      </section>
    );
  }

  const anySolo = tracks.some((t) => t.track.params.solo);

  if (arrangement && view === 'song') {
    return (
      <section aria-label={t('ui.song.region')} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mx-auto flex min-h-0 w-full max-w-[110rem] flex-1 flex-col gap-3 px-3 py-4 sm:px-5 sm:py-5">
          <h2 className="sr-only">{t('ui.song.region')}</h2>
          <SongBar arr={arrangement} />
          <SongView arr={arrangement} tracks={tracks} />
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label={t('ui.regions.tracks')}
      className="@container min-h-0 flex-1 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) selectNode(null);
      }}
    >
      <div
        className="mx-auto flex max-w-[110rem] flex-col gap-3 px-3 py-4 sm:px-5 sm:py-5"
        onClick={(e) => {
          if (e.target === e.currentTarget) selectNode(null);
        }}
      >
        <h2 className="sr-only">{t('ui.regions.tracksHeading', { count: tracks.length })}</h2>
        <SongBar arr={arrangement} />
        {prelude?.trim() ? <PreludeCard code={prelude} selected={selectedId === PRELUDE_ID} /> : null}
        {tracks.map((rt, i) => (
          <TrackRow
            key={rt.track.id}
            rt={rt}
            index={i}
            count={tracks.length}
            selectedId={selectedId}
            dropGap={drop && drop.trackId === rt.track.id ? drop.gap : null}
            anySolo={anySolo}
            diagnostics={diagnostics}
            draggingSource={drag?.isSource === true}
          />
        ))}
        <NewTrackBar />
      </div>
    </section>
  );
}
