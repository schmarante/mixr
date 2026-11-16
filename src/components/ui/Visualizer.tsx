import { useStore } from '@nanostores/react';
import { useEffect, useRef } from 'react';
import { commentText } from '../../agents/compiler/format';
import { t } from '../../i18n';
import { outputAnalyser, playbackState, resolvedTracks, trackHits } from '../../store/agentBus';
import type { ResolvedTrack } from '../../types/ast';
import { TRACK_COLOR_RGB } from './lib/trackColors';
import { visualizerEnabled, visualizerMode } from './lib/visualizerPref';
import type { TrackInfo } from './visualizer/colors';
import { createScene, type Scene } from './visualizer/scene';

/**
 * Hörbare Spuren (nicht stumm; bei Solo nur die Solo-Spuren) mit Farbe. Der Name
 * entspricht dem Kommentar, den der Compiler vor die Spur schreibt – darüber werden
 * die Anschläge (`trackHits`) zugeordnet.
 */
function audibleTrackColors(tracks: readonly ResolvedTrack[]): TrackInfo[] {
  const anySolo = tracks.some((tr) => tr.track.params.solo);
  return tracks
    .filter((tr) => !tr.track.params.muted && (!anySolo || tr.track.params.solo))
    .map(({ track }) => ({
      name: commentText(String(track.params.name ?? '')) || t('compiler.unnamedTrack'),
      rgb: TRACK_COLOR_RGB[track.params.color] ?? TRACK_COLOR_RGB.violet,
    }));
}

/**
 * Hintergrund-Insel: Canvas hinter der ganzen Oberfläche (scheint durch die Glas-Flächen,
 * fängt keine Klicks ab). Animiert nur während der Wiedergabe.
 */
export default function Visualizer() {
  const enabled = useStore(visualizerEnabled);
  const mode = useStore(visualizerMode);
  const ref = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!enabled || !canvas) return;
    // Schaltet die Glas-Flächen (Blur) frei – siehe .glass in global.css
    document.documentElement.dataset.viz = '';
    const scene = createScene(canvas, visualizerMode.get(), {
      getAnalyser: () => outputAnalyser.get(),
      isPlaying: () => playbackState.get().isPlaying,
    });
    sceneRef.current = scene;
    const unlisten = playbackState.listen((s) => {
      if (s.isPlaying) scene.wake();
    });
    const unsubTracks = resolvedTracks.subscribe((tracks) => scene.setTracks(audibleTrackColors(tracks)));
    const unlistenHits = trackHits.listen((h) => {
      if (h) scene.hit(h.hits);
    });
    return () => {
      unlisten();
      unsubTracks();
      unlistenHits();
      scene.destroy();
      sceneRef.current = null;
      delete document.documentElement.dataset.viz;
    };
  }, [enabled]);

  // Moduswechsel ohne neue Szene (Audio-Analyse und Ein-/Ausblenden laufen weiter)
  useEffect(() => {
    sceneRef.current?.setMode(mode);
  }, [mode]);

  if (!enabled) return null;
  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />;
}
