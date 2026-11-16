/**
 * Hintergrund-Visualizer: gemeinsamer Render-Loop für alle Modi (Effekte).
 * Kümmert sich um Canvas-Größe, Audio-Analyse und Ein-/Ausblenden; was gezeichnet
 * wird, entscheidet der aktive Effekt. Läuft nur, solange gespielt wird bzw. bis die
 * Szene nach dem Stopp ausgeblendet ist.
 */
import type { TrackHit } from '../../../store/agentBus';
import type { VisualizerMode } from '../lib/visualizerPref';
import { AudioAnalysis } from './audio';
import { SceneColors, type TrackInfo } from './colors';
import { createMesh } from './effects/mesh';
import { createPlasma } from './effects/plasma';
import type { Effect } from './effects/types';
import { createWarp } from './effects/warp';

const EFFECTS: Record<VisualizerMode, () => Effect> = {
  warp: createWarp,
  plasma: createPlasma,
  mesh: createMesh,
};

export interface SceneInput {
  /** Analyser am Master-Ausgang (null, solange die Engine nicht geladen ist). */
  getAnalyser: () => AnalyserNode | null;
  /** Spielt gerade etwas? Bestimmt Ein-/Ausblenden. */
  isPlaying: () => boolean;
}

export interface Scene {
  /** Startet die Animationsschleife, falls sie ruht (z. B. bei Play). */
  wake: () => void;
  setMode: (mode: VisualizerMode) => void;
  /** Hörbare Spuren (Name wie im Compiler-Kommentar, Farbe). */
  setTracks: (tracks: readonly TrackInfo[]) => void;
  /** Anschläge seit dem letzten Tick. */
  hit: (hits: readonly TrackHit[]) => void;
  destroy: () => void;
}

export function createScene(canvas: HTMLCanvasElement, mode: VisualizerMode, input: SceneInput): Scene {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { wake: () => {}, setMode: () => {}, setTracks: () => {}, hit: () => {}, destroy: () => {} };

  const audio = new AudioAnalysis();
  const colors = new SceneColors();
  let effect = EFFECTS[mode]();
  let width = 0;
  let height = 0;
  /** 0 = unsichtbar, 1 = voll da (blendet bei Play ein, bei Stopp aus). */
  let presence = 0;
  /** Kurzes Abblenden beim Moduswechsel während der Wiedergabe. */
  let switchFade = 1;
  let rafId: number | null = null;
  let last = 0;

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    audio.setBandCount(effect.bandCount(width));
    colors.setBands(audio.frame.bars.length);
    effect.resize(width, height);
  }

  function frame(ts: number): void {
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 1 / 60;
    last = ts;
    const playing = input.isPlaying();
    const target = playing ? 1 : 0;
    presence += (target - presence) * Math.min(1, dt * (target ? 3 : 1.6));
    switchFade = Math.min(1, switchFade + dt * 2.5);

    audio.update(playing ? input.getAnalyser() : null, dt);
    colors.update(dt);
    ctx!.clearRect(0, 0, width, height);
    if (target === 0 && presence < 0.01) {
      // ausgeblendet: Schleife ruhen lassen, bis wieder gespielt wird
      presence = 0;
      rafId = null;
      last = 0;
      return;
    }
    effect.draw(ctx!, audio.frame, colors, presence * switchFade);
    ctx!.globalAlpha = 1;
    ctx!.globalCompositeOperation = 'source-over';
    rafId = requestAnimationFrame(frame);
  }

  function wake(): void {
    if (rafId === null) rafId = requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', resize);
  wake();

  return {
    wake,
    setMode(next) {
      effect = EFFECTS[next]();
      audio.setBandCount(effect.bandCount(width));
      colors.setBands(audio.frame.bars.length);
      effect.resize(width, height);
      switchFade = 0;
    },
    setTracks: (tracks) => colors.setTracks(tracks),
    hit: (hits) => colors.hit(hits),
    destroy() {
      window.removeEventListener('resize', resize);
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      ctx.clearRect(0, 0, width, height);
    },
  };
}
