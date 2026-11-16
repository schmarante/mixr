import { useEffect } from 'react';
import { getBlockDef } from '../../../blocks/catalog';
import { resolvedTracks, uiState } from '../../../store/agentBus';
import { moveBlock, moveTrack, redo, removeBlock, selectNode, undo } from '../../../store/actions';
import { t } from '../../../i18n';
import { showToast } from '../lib/importFlow';
import { keepPreludeSelection } from '../lib/prelude';
import { togglePlayback } from '../lib/transport';
import { nextVisualizerMode, visualizerEnabled } from '../lib/visualizerPref';

/** Ist das Ziel ein Feld, in dem Tasten „normal“ funktionieren sollen? */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color'].includes(target.type);
  }
  return false;
}

/** Findet Spur & Position eines Blocks in der aufgelösten Kette. */
function locateBlock(blockId: string) {
  const tracks = resolvedTracks.get();
  for (let t = 0; t < tracks.length; t++) {
    const rt = tracks[t]!;
    const i = rt.chain.findIndex((b) => b.id === blockId);
    if (i >= 0) return { trackIndex: t, track: rt, index: i, block: rt.chain[i]! };
  }
  return null;
}

/**
 * Globale Tastenkürzel:
 * - Leertaste: Play/Stop (nicht in Eingabefeldern, nicht in Elementen mit data-keep-space)
 * - Strg/Cmd+Z, Shift+Strg/Cmd+Z, Strg+Y: Rückgängig / Wiederholen
 * - Entf/Backspace: ausgewählten Baustein löschen
 * - Esc: Auswahl aufheben
 * - V: nächster Visualizer-Modus (nur bei eingeschaltetem Visualizer)
 * - Alt+←/→: ausgewählten Baustein verschieben; Alt+↑/↓: ausgewählte Spur verschieben
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      // Modale Dialoge regeln ihre Tasten selbst
      if (document.querySelector('dialog[open]')) return;
      const typing = isTypingTarget(e.target);
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;

      if (key === ' ' && !typing && !mod && !e.altKey) {
        if (e.target instanceof HTMLElement && e.target.closest('[data-keep-space]')) return;
        e.preventDefault();
        togglePlayback(); // synchron im Keydown → User-Geste für den AudioContext
        return;
      }

      if (mod && !e.altKey && !typing) {
        const k = key.toLowerCase();
        if (k === 'z') {
          e.preventDefault();
          keepPreludeSelection(e.shiftKey ? redo : undo);
          return;
        }
        if (k === 'y') {
          e.preventDefault();
          keepPreludeSelection(redo);
          return;
        }
      }

      if (typing) return;

      if (!mod && !e.altKey && key.toLowerCase() === 'v' && visualizerEnabled.get()) {
        e.preventDefault();
        const next = nextVisualizerMode();
        showToast(t('ui.visualizer.switched', { name: t(`ui.visualizer.modes.${next}`) }));
        return;
      }

      const selected = uiState.get().selectedNodeId;

      if (key === 'Escape') {
        if (selected) {
          selectNode(null);
          e.preventDefault();
        }
        return;
      }

      if (!selected) return;

      if ((key === 'Delete' || key === 'Backspace') && !mod) {
        // Nicht aus dem Inspector heraus (z. B. Backspace im Raster soll nicht den ganzen Baustein löschen)
        if (e.target instanceof HTMLElement && e.target.closest('[data-inspector]')) return;
        if (locateBlock(selected)) {
          e.preventDefault();
          removeBlock(selected);
        }
        return;
      }

      if (e.altKey && !mod) {
        const loc = locateBlock(selected);
        if (loc && (key === 'ArrowLeft' || key === 'ArrowRight')) {
          e.preventDefault();
          if (getBlockDef(loc.block.type).kind === 'source') return;
          const to = key === 'ArrowLeft' ? loc.index - 1 : loc.index + 1;
          if (to < 0 || to >= loc.track.chain.length) return;
          moveBlock(selected, loc.track.track.id, to);
          return;
        }
        if (key === 'ArrowUp' || key === 'ArrowDown') {
          const tracks = resolvedTracks.get();
          const ti = tracks.findIndex((t) => t.track.id === selected);
          if (ti >= 0) {
            e.preventDefault();
            const to = key === 'ArrowUp' ? ti - 1 : ti + 1;
            if (to >= 0 && to < tracks.length) moveTrack(selected, to);
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
