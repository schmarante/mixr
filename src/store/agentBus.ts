import { atom, computed, map } from 'nanostores';
import type { ProjectSettings, VisualAst } from '../types/ast';
import { resolveTracks } from './selectors';

/**
 * Das Nervensystem: Nano Stores als Event-Bus zwischen den Agenten.
 *
 * Schreibrechte (Konvention, nicht technisch erzwungen):
 *  - visualAstStore, projectSettings  → nur über src/store/actions.ts (UI- & AI-Agent)
 *  - compiledStrudelCode, compileState → nur CompilerAgent
 *  - playbackState                     → nur AudioAgent
 *  - transportCommand                  → UI (Wunsch), AudioAgent setzt um
 *  - uiState                           → nur UI
 *  - codeOverride                      → nur Live-Code (Code-Editor), AudioAgent spielt ihn
 *  - activeLocations, playingCode,
 *    codeErrorRange, lastEvaluation    → nur AudioAgent (Highlighter, Fehlerstelle, Urteil)
 *
 * SSR-Hinweis: Die Stores sind auf dem Server modulweit geteilt. Server-Code darf
 * sie daher nur LESEN (Default-Zustand rendern), niemals schreiben.
 */

// 1. UI-Agent speichert hier die visuelle Struktur, Compiler liest sie
export const visualAstStore = map<VisualAst>({
  nodes: [],
  edges: [],
});

export const projectSettings = map<ProjectSettings>({
  bpm: 120,
});

/** Abgeleitet: Spuren mit aufgelöster Blockkette (für UI & Compiler). */
export const resolvedTracks = computed(visualAstStore, (ast) => resolveTracks(ast));

// 2. Compiler-Agent schreibt den fertigen Code, Audio-Agent liest ihn
export const compiledStrudelCode = atom<string>('');

export interface CompileDiagnostic {
  /** Betroffener Knoten (Spur oder Block), falls zuordenbar. */
  nodeId: string | null;
  message: string;
}

export const compileState = map<{ diagnostics: CompileDiagnostic[] }>({
  diagnostics: [],
});

// 3. Audio-Agent meldet Playback-Status an die UI zurück
export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PlaybackState {
  isPlaying: boolean;
  /** Aktuelle Zyklusposition (Fließkomma, z. B. 12.375). Während Wiedergabe ~30×/s aktualisiert. */
  currentCycle: number;
  status: EngineStatus;
  /** Lesbare Fehlermeldung (Laufzeit-/Evaluationsfehler), sonst null. */
  error: string | null;
}

export const playbackState = map<PlaybackState>({
  isPlaying: false,
  currentCycle: 0,
  status: 'idle',
  error: null,
});

/**
 * Transport-Wunsch der UI. Die UI setzt nur diesen Store, der AudioAgent
 * reagiert darauf (Audio-Init braucht eine User-Geste → wird synchron im
 * Klick-Handler gesetzt, der AudioAgent startet daraufhin den AudioContext).
 */
export const transportCommand = atom<{ action: 'play' | 'stop'; at: number } | null>(null);

// 4. Reiner UI-Zustand (geteilt zwischen den React-Inseln)
export interface UiState {
  selectedNodeId: string | null;
  codePanelOpen: boolean;
}

export const uiState = map<UiState>({
  selectedNodeId: null,
  codePanelOpen: false,
});

// 5. Code-Editor ↔ Engine (Live-Code)

/**
 * Editor-Override: Solange der Nutzer im Code-Panel eigenen Text hat, der (noch) nicht
 * dem kompilierten Code entspricht, spielt der AudioAgent GENAU diesen Text statt
 * `compiledStrudelCode`. `null` = die Bausteine (kompilierter Code) sind die Quelle.
 * Schreiber: nur der Live-Code-Controller (src/components/ui/editor/liveCode.ts).
 */
export const codeOverride = atom<string | null>(null);

/**
 * Zählt hoch, sobald ein anderes Projekt geladen wurde (Vorlage, Datei, Import, Neu).
 * Der AudioAgent schneidet dann Nachhall/Echo des alten Projekts ab und spielt das
 * neue von vorne. Schreiber: loadProject (store/actions.ts).
 */
export const projectEpoch = atom(0);

/** Bereich im Code als Zeichen-Offsets [start, end). */
export interface CodeRange {
  start: number;
  end: number;
}

/**
 * Highlighter: Positionen der gerade klingenden Mini-Notation-Atome
 * (`hap.context.locations`) – gültig für genau den Text `code`, der evaluiert wurde.
 * Nur während der Wiedergabe gefüllt, nur bei Änderung neu gesetzt. Schreiber: AudioAgent.
 */
export const activeLocations = atom<{ code: string; ranges: readonly CodeRange[] }>({ code: '', ranges: [] });

/** Zuletzt erfolgreich evaluierter Text (= was gerade spielt). Schreiber: AudioAgent. */
export const playingCode = atom<string>('');

/**
 * Stelle des letzten Evaluationsfehlers im evaluierten Text `code` (Syntaxfehler,
 * Mini-Notation), sonst null. Schreiber: AudioAgent.
 */
export const codeErrorRange = atom<({ code: string } & CodeRange) | null>(null);

/**
 * Ergebnis der letzten Evaluierung (Erfolg/Fehler) für genau den Text `code` – auch für
 * Editor-Text bei gestoppter, aber bereits geladener Engine. Neues Objekt je Versuch.
 * Der Live-Code übernimmt Editor-Text erst in die Bausteine, wenn die Engine ihn akzeptiert.
 * Schreiber: AudioAgent.
 */
export const lastEvaluation = atom<{ code: string; ok: boolean } | null>(null);
