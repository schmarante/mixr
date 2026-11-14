import { atom } from 'nanostores';
import type { ImportResult } from '../../../agents/importer';
import { t, type TKey } from '../../../i18n';
import { playbackState, projectSettings, visualAstStore } from '../../../store/agentBus';
import { appendProject, loadProject } from '../../../store/actions';
import { showToast } from './importFlow';
import { projectName } from './projectFiles';
import { requestPlay } from './transport';

/**
 * MIDI rein und raus (UI-Seite). Der eigentliche Import/Export (SMF-Parser,
 * Abbildung, Strudel-Auswertung) wird erst beim ersten Gebrauch nachgeladen –
 * nichts davon steckt im Start-Bundle.
 */

export const MIDI_EXTENSIONS = ['.mid', '.midi', '.smf', '.kar'] as const;
export const MIDI_ACCEPT = [...MIDI_EXTENSIONS, 'audio/midi', 'audio/x-midi'].join(',');
export const MIDI_MIME = /^audio\/(x-)?mid/;

export function isMidiFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return MIDI_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

/** MIDI-Datei, die auf „Öffnen/Hinzufügen“ wartet (Vorschau-Dialog). */
export interface PendingMidi {
  name: string;
  result: ImportResult;
}
export const pendingMidi = atom<PendingMidi | null>(null);

function stem(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

/** Liest eine MIDI-Datei und zeigt die Vorschau (bei Fehlern ein Hinweis). */
export async function openMidiFile(file: File): Promise<void> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { importMidi, MidiImportError } = await import('../../../agents/midi/import');
    try {
      pendingMidi.set({ name: file.name, result: importMidi(bytes) });
    } catch (err) {
      if (err instanceof MidiImportError) showToast(t(err.messageKey, err.params));
      else throw err;
    }
  } catch (err) {
    console.warn('[midi] import failed', err);
    showToast(t('midi.error.unreadable'));
  }
}

/** Datei-Auswahl „MIDI importieren…“ (synchron im Klick aufrufen). */
export function pickMidiFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = MIDI_ACCEPT;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void openMidiFile(file);
  });
  input.click();
}

/** Übernimmt die wartende MIDI-Datei – synchron im Klick (Autoplay = User-Geste). */
export function applyPendingMidi(mode: 'replace' | 'append', autoplay: boolean): void {
  const pending = pendingMidi.get();
  if (!pending) return;
  const { result } = pending;
  if (mode === 'append') appendProject(result.ast);
  else {
    // Eigene Sample-Slots bleiben (MIDI bringt keine mit)
    const samples = projectSettings.get().samples;
    loadProject(result.ast, samples ? { ...result.settings, samples } : result.settings);
    projectName.set(stem(pending.name));
  }
  pendingMidi.set(null);
  if (autoplay && !playbackState.get().isPlaying) requestPlay();
  const parts = [t('midi.ui.toastImported', { count: result.stats.tracks })];
  if (result.stats.substituted > 0) parts.push(t('ui.import.toast.substituted', { count: result.stats.substituted }));
  if (result.stats.codeBlocks > 0) parts.push(t('ui.import.toast.keptAsCode', { count: result.stats.codeBlocks }));
  showToast(parts.join(' · '), { undo: true });
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export const midiExportOpen = atom(false);

/** Vorgeschlagene Länge in Takten (lädt Strudel bei Bedarf). */
export async function suggestBars(): Promise<number> {
  const { suggestMidiBars } = await import('../../../agents/midi/export');
  return suggestMidiBars(visualAstStore.get(), projectSettings.get());
}

/** Zahl der Spuren, die im Export landen (hörbar). */
export async function audibleTrackCount(): Promise<number> {
  const { audibleTracks } = await import('../../../agents/midi/export');
  return audibleTracks(visualAstStore.get()).length;
}

function midiFileName(): string {
  const base = projectName.get().trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '');
  return `${base ? `strudelmixr-${base}` : 'strudelmixr'}.mid`;
}

function saveBytes(bytes: Uint8Array, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/midi' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Exportiert und lädt die Datei herunter. Liefert die Hinweise (übersetzt) oder wirft. */
export async function downloadMidi(bars: number): Promise<string[]> {
  const { exportMidi } = await import('../../../agents/midi/export');
  const res = await exportMidi(visualAstStore.get(), projectSettings.get(), { bars, title: projectName.get() || 'strudelmixr' });
  if (res.tracks.length === 0) throw new Error('no notes');
  saveBytes(res.bytes, midiFileName());
  showToast(t('midi.ui.toastExported', { count: res.tracks.length, bars: res.bars }));
  return res.notes.map((n) => t(n.key as TKey, n.params));
}
