import { atom } from 'nanostores';
import { ImportError, importStrudelCode, type ImportResult } from '../../../agents/importer';
import { t, type TKey, type TParams } from '../../../i18n';
import { playbackState, projectSettings } from '../../../store/agentBus';
import { appendProject, loadProject, undo } from '../../../store/actions';
import { sampleSlots } from '../../../store/userSamples';
import { requestPlay } from './transport';

/**
 * Ablauf „Fremden Strudel-Code importieren“ – geteilter Zustand für alle Inseln:
 * Topbar-Button, Code-Panel, Startbildschirm, Einfügen-Erkennung und Datei-Drop
 * öffnen denselben Dialog (gerendert in der Topbar-Insel).
 */

export interface ImportDialogState {
  open: boolean;
  /** Vorbefüllter Text; ändert sich nur zusammen mit `nonce`. */
  text: string;
  /** Name der Datei, aus der der Text stammt (Anzeige). */
  fileName: string | null;
  /** Zähler: neuer Wert = Dialog übernimmt `text` neu. */
  nonce: number;
}

export const importDialog = atom<ImportDialogState>({ open: false, text: '', fileName: null, nonce: 0 });

/**
 * Öffnet den Import-Dialog. Mit `text` wird das Textfeld damit gefüllt,
 * ohne bleibt ein vorhandener Entwurf erhalten.
 */
export function openImport(text?: string, fileName: string | null = null): void {
  const cur = importDialog.get();
  importDialog.set(
    text === undefined
      ? { ...cur, open: true }
      : { open: true, text, fileName, nonce: cur.nonce + 1 },
  );
}

export function closeImport(): void {
  importDialog.set({ ...importDialog.get(), open: false });
}

/** Läuft gerade ein Datei-Drag über dem Fenster? (Overlay bzw. Hervorhebung im Dialog) */
export const fileDragActive = atom(false);

/* ------------------------------------------------------------------ */
/* Erkennung                                                           */
/* ------------------------------------------------------------------ */

export const IMPORT_FILE_EXTENSIONS = ['.js', '.mjs', '.txt', '.strudel'] as const;
export const IMPORT_FILE_ACCEPT = [...IMPORT_FILE_EXTENSIONS, 'text/javascript', 'text/plain'].join(',');
/** Größere Dateien sind sicher kein Strudel-Stück (Schutz vor versehentlichem Einlesen). */
export const IMPORT_MAX_BYTES = 512 * 1024;

export function isImportFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return IMPORT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Ein einzelner strudel.cc-Link (Share-Link der REPL)? */
export function isStrudelLink(text: string): boolean {
  return /^https?:\/\/([\w-]+\.)*strudel\.cc(\/\S*)?$/i.test(text.trim());
}

/* ------------------------------------------------------------------ */
/* Analyse (Vorschau)                                                  */
/* ------------------------------------------------------------------ */

export type ImportAnalysis =
  | { status: 'empty' }
  | { status: 'ok'; result: ImportResult }
  | { status: 'error'; message: { key: TKey; params?: TParams } | null; line: number | null; column: number | null };

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Wandelt Code testweise um – wirft nie. */
export function analyzeImport(code: string): ImportAnalysis {
  if (code.trim() === '') return { status: 'empty' };
  try {
    // Eigene Sample-Slots gelten als vorhandene Klänge (werden nicht ersetzt)
    return { status: 'ok', result: importStrudelCode(code, { availableSounds: sampleSlots.get().map((s) => s.name) }) };
  } catch (err) {
    if (err instanceof ImportError) {
      const message = err.params === undefined ? { key: err.messageKey } : { key: err.messageKey, params: err.params };
      return { status: 'error', message, line: num(err.params?.['line']), column: num(err.params?.['column']) };
    }
    console.warn('[import] unexpected error', err);
    return { status: 'error', message: null, line: null, column: null };
  }
}

/* ------------------------------------------------------------------ */
/* Übernehmen                                                          */
/* ------------------------------------------------------------------ */

export type ImportMode = 'replace' | 'append';

/** Kurze Zusammenfassung für die Bestätigung („4 Spuren importiert · 3 Klänge ersetzt“). */
export function importSummary(result: ImportResult, mode: ImportMode): string {
  const { stats } = result;
  const parts = [t(mode === 'append' ? 'ui.import.toast.added' : 'ui.import.toast.imported', { count: stats.tracks })];
  if (stats.substituted > 0) parts.push(t('ui.import.toast.substituted', { count: stats.substituted }));
  if (stats.codeBlocks > 0) parts.push(t('ui.import.toast.keptAsCode', { count: stats.codeBlocks }));
  if (stats.dropped > 0) parts.push(t('ui.import.toast.dropped', { count: stats.dropped }));
  return parts.join(' · ');
}

/**
 * Übernimmt ein Import-Ergebnis (ein Undo-Schritt). MUSS synchron im Klick-Handler
 * laufen, damit „Direkt abspielen“ als User-Geste für den AudioContext zählt.
 * @returns IDs der neuen Spuren beim Hinzufügen, sonst leer
 */
export function applyImport(result: ImportResult, mode: ImportMode, autoplay: boolean): string[] {
  let added: string[] = [];
  // Setup-Code: beim Ersetzen über result.settings (loadProject), beim Hinzufügen angehängt – je ein Undo-Schritt
  if (mode === 'append') added = appendProject(result.ast, result.settings.prelude, result.settings.samples);
  else {
    // Fremder Code bringt keine Samples mit – die eigenen Slots bleiben (sonst klänge er nicht)
    const samples = projectSettings.get().samples;
    loadProject(result.ast, samples ? { ...result.settings, samples } : result.settings);
  }
  if (autoplay && !playbackState.get().isPlaying) requestPlay();
  showToast(importSummary(result, mode), { undo: true });
  importDialog.set({ open: false, text: '', fileName: null, nonce: importDialog.get().nonce + 1 });
  return added;
}

/* ------------------------------------------------------------------ */
/* Dezente Bestätigung (Toast)                                         */
/* ------------------------------------------------------------------ */

export interface ToastState {
  id: number;
  text: string;
  /** Rückgängig-Knopf anbieten. */
  undo: boolean;
}

export const toast = atom<ToastState | null>(null);
let toastId = 0;

export function showToast(text: string, opts: { undo?: boolean } = {}): void {
  toast.set({ id: ++toastId, text, undo: opts.undo === true });
}

export function dismissToast(): void {
  toast.set(null);
}

export function undoFromToast(): void {
  undo();
  dismissToast();
}
