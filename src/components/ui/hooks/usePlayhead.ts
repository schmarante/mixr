import { useStore } from '@nanostores/react';
import { useMemo, useSyncExternalStore } from 'react';
import { playbackState, resolvedTracks, visualAstStore } from '../../../store/agentBus';
import { songPosition } from '../lib/arrangement';

const subscribe = (cb: () => void) => playbackState.listen(cb);

/** Zeit-Umformung eines Modifier-Bausteins in der Kette (für das Lauflicht). */
export interface TimeTransform {
  kind: 'fast' | 'slow' | 'rev';
  factor: number;
}

const NONE: readonly TimeTransform[] = [];

/**
 * Zeitwirksame Bausteine NACH der Klangquelle `blockId` (fast/slow/rev, nicht überbrückt) –
 * damit das Lauflicht auch mit „Schneller“/„Langsamer“/„Rückwärts“ an der richtigen Stelle steht.
 */
export function useChainTransforms(blockId: string | undefined): readonly TimeTransform[] {
  const tracks = useStore(resolvedTracks);
  const list: TimeTransform[] = [];
  if (blockId) {
    for (const rt of tracks) {
      const i = rt.chain.findIndex((b) => b.id === blockId);
      if (i < 0) continue;
      for (const b of rt.chain.slice(i + 1)) {
        if (b.bypassed) continue;
        const f = typeof b.params['factor'] === 'number' && b.params['factor'] > 0 ? b.params['factor'] : 1;
        if (b.type === 'fast' || b.type === 'slow') list.push({ kind: b.type, factor: f });
        if (b.type === 'rev') list.push({ kind: 'rev', factor: 1 });
      }
      break;
    }
  }
  const key = list.map((x) => `${x.kind}${x.factor}`).join(',');
  // stabile Referenz, solange sich die Umformungen nicht ändern
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (list.length === 0 ? NONE : list), [key]);
}

/**
 * Rechnet die Zeit des Ausgangs (Zyklen) in die Zeit der Klangquelle um. Der äußerste
 * (letzte) Baustein wirkt zuerst: x.fast(2).rev() → erst rev, dann fast.
 */
function innerTime(cycle: number, transforms: readonly TimeTransform[]): number {
  let t = cycle;
  for (let i = transforms.length - 1; i >= 0; i--) {
    const tr = transforms[i]!;
    if (tr.kind === 'fast') t *= tr.factor;
    else if (tr.kind === 'slow') t /= tr.factor;
    else {
      const whole = Math.floor(t);
      t = whole + Math.max(0, 1 - (t - whole) - 1e-9);
    }
  }
  return t;
}

/**
 * Aktueller Step im Takt (Lauflicht) oder null, wenn nichts läuft.
 * Rendert nur neu, wenn sich der Step ändert – nicht bei jedem der ~30 Cycle-Updates pro Sekunde.
 */
export function usePlayheadStep(steps: number, transforms: readonly TimeTransform[] = NONE): number | null {
  return usePlayheadColumn(steps, 1, transforms);
}

/**
 * Lauflicht für (mehrtaktige) Raster: Spalte im ganzen Raster (Takt × steps + Step) oder
 * null. Takt = Zyklus mod bars (der Compiler streckt die Melodie mit .slow(bars)).
 */
export function usePlayheadColumn(steps: number, bars: number, transforms: readonly TimeTransform[] = NONE): number | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      const s = playbackState.get();
      return s.isPlaying ? columnAt(s.currentCycle, steps, bars, transforms) : null;
    },
    () => null,
  );
}

/** Spalte im Raster zum (Quell-)Zyklus. */
function columnAt(cycle: number, steps: number, bars: number, transforms: readonly TimeTransform[]): number | null {
  if (steps <= 0 || bars <= 0) return null;
  const t = innerTime(cycle, transforms);
  const pos = (((t % bars) + bars) % bars) / bars;
  const total = steps * bars;
  return Math.min(total - 1, Math.floor(pos * total));
}

/**
 * Lauflicht einer Klangquelle: wie `usePlayheadColumn`, berücksichtigt zusätzlich
 * die Zeit-Bausteine der Kette und das Arrangement – im Song beginnt jeder Abschnitt
 * die Spur von vorn (wie Strudels `arrange`), und wo die Spur aus ist, läuft kein Licht.
 */
export function useSourcePlayhead(blockId: string | undefined, steps: number, bars = 1): number | null {
  const transforms = useChainTransforms(blockId);
  const tracks = useStore(resolvedTracks);
  const arrangement = useStore(visualAstStore).arrangement;
  const trackId = blockId ? tracks.find((rt) => rt.chain.some((b) => b.id === blockId))?.track.id : undefined;
  return useSyncExternalStore(
    subscribe,
    () => {
      const s = playbackState.get();
      if (!s.isPlaying) return null;
      const row = arrangement && trackId ? arrangement.cells[trackId] : undefined;
      if (!arrangement || !row || arrangement.sections.length === 0) return columnAt(s.currentCycle, steps, bars, transforms);
      const pos = songPosition(s.currentCycle, arrangement);
      const section = pos ? arrangement.sections[pos.index] : undefined;
      if (!pos || !section || !row[section.id]?.on) return null;
      return columnAt(pos.frac * section.cycles, steps, bars, transforms);
    },
    () => null,
  );
}
