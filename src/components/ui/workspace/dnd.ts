import { atom } from 'nanostores';
import type { DragEvent } from 'react';
import { getBlockDef } from '../../../blocks/catalog';
import { moveBlock, selectNode } from '../../../store/actions';
import type { ResolvedTrack } from '../../../types/ast';

/**
 * Drag & Drop für Bausteine (natives HTML5-DnD, keine Zusatz-Library).
 * Tastatur-Alternative: Alt+←/→ (siehe useGlobalShortcuts).
 */

export const DND_MIME = 'application/x-strudelmixr-block';

export interface DragInfo {
  blockId: string;
  fromTrackId: string;
  isSource: boolean;
}

/** Aktuell gezogener Baustein. */
export const dragInfo = atom<DragInfo | null>(null);
/** Einfügeposition (Lücke vor Kettenposition `gap`) unter dem Mauszeiger. */
export const dropTarget = atom<{ trackId: string; gap: number } | null>(null);

export function hasSource(rt: ResolvedTrack): boolean {
  const first = rt.chain[0];
  return first !== undefined && getBlockDef(first.type).kind === 'source';
}

/**
 * Prüft/normalisiert eine Einfügeposition. null = hier nicht ablegbar
 * (oder es würde sich nichts ändern).
 */
export function resolveGap(rt: ResolvedTrack, gap: number, drag: DragInfo): number | null {
  const sameTrack = rt.track.id === drag.fromTrackId;
  if (drag.isSource) {
    // Quelle nur in Spuren ohne Quelle – und immer an Position 0
    if (sameTrack || hasSource(rt)) return null;
    return 0;
  }
  const min = hasSource(rt) ? 1 : 0;
  const g = Math.max(min, Math.min(gap, rt.chain.length));
  if (sameTrack) {
    const from = rt.chain.findIndex((b) => b.id === drag.blockId);
    if (g === from || g === from + 1) return null;
  }
  return g;
}

export function commitDrop(rt: ResolvedTrack, gap: number, drag: DragInfo): void {
  const g = resolveGap(rt, gap, drag);
  if (g === null) return;
  let to = g;
  if (rt.track.id === drag.fromTrackId) {
    const from = rt.chain.findIndex((b) => b.id === drag.blockId);
    if (from >= 0 && g > from) to = g - 1;
  }
  moveBlock(drag.blockId, rt.track.id, to);
  selectNode(drag.blockId);
}

/** Gemeinsamer dragover-Handler: setzt Indikator und erlaubt Drop nur an gültigen Stellen. */
export function handleDragOver(e: DragEvent<HTMLElement>, rt: ResolvedTrack, rawGap: number): void {
  const info = dragInfo.get();
  if (!info) return;
  e.stopPropagation();
  const gap = resolveGap(rt, rawGap, info);
  const cur = dropTarget.get();
  if (gap === null) {
    if (cur !== null) dropTarget.set(null);
    return;
  }
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (!cur || cur.trackId !== rt.track.id || cur.gap !== gap) dropTarget.set({ trackId: rt.track.id, gap });
}

export function handleDrop(e: DragEvent<HTMLElement>, rt: ResolvedTrack): void {
  const info = dragInfo.get();
  const target = dropTarget.get();
  e.preventDefault();
  e.stopPropagation();
  if (info && target && target.trackId === rt.track.id) commitDrop(rt, target.gap, info);
  dragInfo.set(null);
  dropTarget.set(null);
}

export function startDrag(e: DragEvent<HTMLElement>, info: DragInfo, label: string): void {
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData(DND_MIME, info.blockId);
  e.dataTransfer.setData('text/plain', label);
  dragInfo.set(info);
}

export function endDrag(): void {
  dragInfo.set(null);
  dropTarget.set(null);
}
