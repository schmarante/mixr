import { atom } from 'nanostores';
import { useSyncExternalStore } from 'react';
import { t } from '../../../i18n';
import { playbackState } from '../../../store/agentBus';
import type { Arrangement, ArrangementSection } from '../../../types/ast';

/**
 * Helfer für den Song-Ablauf (Arrangement): Ansicht, Anzeige-Texte, Wiedergabeposition.
 */

/** Workspace-Ansicht: Spuren (Bausteine bearbeiten) oder Song (Zeitleiste). */
export const workspaceView = atom<'tracks' | 'song'>('tracks');

/** Anzeigename eines Abschnitts („Intro“ bzw. „Section 3“). */
export function sectionName(section: ArrangementSection, index: number): string {
  return section.name?.trim() || t('ui.song.sectionFallback', { number: index + 1 });
}

export function totalCycles(arr: Arrangement): number {
  return arr.sections.reduce((sum, s) => sum + (Number.isFinite(s.cycles) && s.cycles > 0 ? s.cycles : 0), 0);
}

/** Dauer in „m:ss“ (4 Schläge pro Takt/Zyklus, wie im Compiler: setcpm(bpm/4)). */
export function formatDuration(cycles: number, bpm: number): string {
  const seconds = Math.round((cycles * 4 * 60) / Math.max(1, bpm));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Kurzes Badge für eine Variante: „.lpf(800).room(.5)“ → „lpf+“. */
export function variantBadge(code: string): string {
  const names = [...code.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]!);
  if (names.length === 0) return 'fx';
  return names.length > 1 ? `${names[0]}+` : names[0]!;
}

export interface SongPosition {
  /** Index des gerade spielenden Abschnitts. */
  index: number;
  /** Fortschritt innerhalb des Abschnitts (0…1). */
  frac: number;
}

/** Index des Startabschnitts („ab hier spielen“) oder 0. */
export function startIndex(arr: Arrangement): number {
  if (!arr.startSection) return 0;
  return Math.max(0, arr.sections.findIndex((s) => s.id === arr.startSection));
}

/**
 * Abspielreihenfolge der Abschnitte (Indizes): ab dem Startabschnitt, danach der
 * Anfang – genau wie der Compiler das Arrangement dreht (Strudel startet bei Zyklus 0).
 */
export function playOrder(arr: Arrangement): number[] {
  const n = arr.sections.length;
  const start = startIndex(arr);
  return Array.from({ length: n }, (_, k) => (start + k) % n);
}

/**
 * Position im Song zum Engine-Zyklus: mit Schleife innerhalb des Abschnitts, sonst
 * Zyklus mod Gesamtlänge – Zyklus 0 = Beginn des Startabschnitts, am Ende geht es
 * mit dem Anfang weiter.
 */
export function songPosition(cycle: number, arr: Arrangement): SongPosition | null {
  const sections = arr.sections;
  if (sections.length === 0) return null;
  if (arr.loopSection) {
    const i = sections.findIndex((s) => s.id === arr.loopSection);
    if (i >= 0) {
      const c = sections[i]!.cycles;
      return { index: i, frac: (((cycle % c) + c) % c) / c };
    }
  }
  const total = totalCycles(arr);
  if (total <= 0) return null;
  let pos = ((cycle % total) + total) % total;
  const order = playOrder(arr);
  for (const i of order) {
    const c = sections[i]!.cycles;
    if (pos < c) return { index: i, frac: pos / c };
    pos -= c;
  }
  return { index: order[order.length - 1]!, frac: 1 };
}

/** Takte vor Abschnitt `index` in Song-Reihenfolge (für „Takt 27 / 124“). */
export function cyclesBefore(arr: Arrangement, index: number): number {
  return arr.sections.slice(0, index).reduce((sum, s) => sum + s.cycles, 0);
}

const subscribe = (cb: () => void) => playbackState.listen(cb);

/** Index des spielenden Abschnitts (oder -1) – rendert nur bei Abschnittswechsel neu. */
export function usePlayingSection(arr: Arrangement): number {
  return useSyncExternalStore(
    subscribe,
    () => {
      const s = playbackState.get();
      if (!s.isPlaying) return -1;
      return songPosition(s.currentCycle, arr)?.index ?? -1;
    },
    () => -1,
  );
}

/**
 * Feiner Fortschritt (für die Positionslinie), auf 1/200 gerundet, damit nicht bei
 * jedem Engine-Tick neu gerendert wird. -1 = steht.
 */
export function usePlayProgress(arr: Arrangement): { index: number; frac: number } {
  const key = useSyncExternalStore(
    subscribe,
    () => {
      const s = playbackState.get();
      if (!s.isPlaying) return '-1';
      const p = songPosition(s.currentCycle, arr);
      return p ? `${p.index}:${Math.floor(p.frac * 200)}` : '-1';
    },
    () => '-1',
  );
  if (key === '-1') return { index: -1, frac: 0 };
  const [i, f] = key.split(':');
  return { index: Number(i), frac: Number(f) / 200 };
}
