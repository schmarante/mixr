/**
 * Live-Code: hält Code-Editor, Engine und Bausteine synchron (das Herzstück des Editors).
 *
 * Zustände (`mode`):
 *  - 'blocks'   Der Editor zeigt den kompilierten Code der Bausteine und folgt jeder Änderung.
 *  - 'typing'   Der Nutzer tippt; nach einer kurzen Pause (DEBOUNCE_MS) wird angewendet.
 *  - 'linked'   Der Editor-Text spielt (Override) und ist in die Bausteine übernommen.
 *               Beim Verlassen des Editors bzw. Strg/⌘+Enter wird der Text auf den
 *               kanonischen kompilierten Code umgestellt („angeglichen“).
 *  - 'codeMode' Der Editor-Text spielt, lässt sich aber nicht als Bausteine darstellen
 *               (Syntaxfehler, kein Pattern, uneinheitlicher Song-Ablauf). Er bleibt erhalten,
 *               bis der Nutzer ihn korrigiert oder „Zurück zu den Bausteinen“ wählt.
 *
 * Regeln:
 *  - Code → Musik: angewendet wird GENAU der Editor-Text (Store `codeOverride`, AudioAgent).
 *  - Code → Bausteine: Import + `syncProjectFromCode` (ID-erhaltend, ein Undo-Schritt pro Tipp-Serie).
 *  - Bausteine → Code: Der Editor folgt, außer er ist fokussiert UND schmutzig. Ein nicht
 *    fokussierter Code-Modus-Text, den eine Bausteinänderung ersetzt, bleibt als Entwurf
 *    wiederherstellbar (`discarded`).
 *
 * Ohne DOM und React – die Abhängigkeiten sind injizierbar (Tests:
 * src/components/ui/editor/__tests__/liveCode.test.ts).
 */
import { map } from 'nanostores';
import { compile } from '../../../agents/compiler/compile';
import { ImportError, importStrudelCode, type ImportResult } from '../../../agents/importer';
import { prepareCode } from '../../../agents/AudioAgent';
import { codeOverride, compiledStrudelCode, lastEvaluation, playbackState, projectSettings, visualAstStore } from '../../../store/agentBus';
import { endEditSeries, syncProjectFromCode } from '../../../store/actions';
import type { CodeSyncResult } from '../../../store/codeSync';

/** Pause nach dem letzten Tastendruck, bis der Editor-Text angewendet wird. */
export const DEBOUNCE_MS = 600;

export type LiveCodeMode = 'blocks' | 'typing' | 'linked' | 'codeMode';
export type CodeModeReason = 'syntax' | 'runtime' | 'noPattern' | 'arrangement' | 'error';

export interface LiveCodeState {
  /** Text im Editor (Quelle der Wahrheit für die Editor-Komponente). */
  text: string;
  mode: LiveCodeMode;
  /** Warum der Text nicht als Bausteine darstellbar ist (nur im Code-Modus). */
  reason: CodeModeReason | null;
  /** Syntaxfehler laut Importer, bezogen auf `forText`. */
  syntax: { forText: string; start: number; end: number; line: number; column: number; message: string } | null;
  /** Dezenter Hinweis nach einer automatischen Umstellung. */
  notice: { kind: 'aligned'; substituted: number } | { kind: 'replaced' } | null;
  /** Durch eine Bausteinänderung ersetzter Code-Modus-Text (wiederherstellbar). */
  discarded: string | null;
}

export interface LiveCodeDeps {
  getCanonical(): string;
  subscribeCanonical(cb: () => void): () => void;
  importCode(text: string): ImportResult;
  sync(result: ImportResult, options: { series: string; hasTempo: boolean }): CodeSyncResult['kind'];
  endSeries(series: string): void;
  setOverride(text: string | null): void;
  /**
   * Akzeptiert die Engine den Text? (true/false; null = unbekannt, z. B. Engine noch nie
   * gestartet.) Erst danach wird in die Bausteine übernommen – ein Zwischenstand wie
   * `.ro.lpf(…)` (gültiges JS, aber Laufzeitfehler) landet so nicht in den Bausteinen.
   */
  validate?(text: string): Promise<boolean | null> | null;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/** Zeile (1-basiert) / Spalte (0-basiert) → Offset. */
export function offsetOf(text: string, line: number, column: number): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < Math.min(line - 1, lines.length); i++) offset += lines[i]!.length + 1;
  return Math.min(text.length, offset + Math.max(0, column));
}

export class LiveCode {
  readonly state = map<LiveCodeState>({ text: '', mode: 'blocks', reason: null, syntax: null, notice: null, discarded: null });
  private focused = false;
  private timer: unknown = null;
  private pending: string | null = null;
  private seriesCount = 0;
  private series = 'code-edit-0';
  private unsubscribe: (() => void) | null = null;
  private applySeq = 0;
  /** Laufende Engine-Prüfung (Übernahme in die Bausteine wartet darauf). */
  private validating: Promise<void> | null = null;

  constructor(private readonly deps: LiveCodeDeps) {}

  /** Abonniert den kompilierten Code (idempotent) und übernimmt ihn in den Editor. */
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.deps.subscribeCanonical(() => this.onCanonical());
    this.onCanonical();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  get isFocused(): boolean {
    return this.focused;
  }

  /* ---------------------------- Editor-Ereignisse ---------------------------- */

  /** Der Nutzer hat den Text geändert (nicht bei programmatischen Updates aufrufen). */
  edit(text: string): void {
    const s = this.state.get();
    if (text === s.text) return;
    this.state.set({ ...s, text, mode: 'typing', notice: null });
    this.pending = text;
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      this.flush();
    }, DEBOUNCE_MS);
  }

  focus(): void {
    this.focused = true;
  }

  /** Editor verlassen: Ausstehendes anwenden, dann (falls darstellbar) an die Bausteine angleichen. */
  blur(): void {
    this.focused = false;
    this.afterApply(() => this.align(), true);
  }

  /** Strg/⌘+Enter: sofort anwenden und angleichen (Fokus bleibt im Editor). */
  commit(): void {
    this.afterApply(() => this.align(), false);
  }

  /** „Zurück zu den Bausteinen“: Editor-Text verwerfen (bleibt als Entwurf wiederherstellbar). */
  backToBlocks(): void {
    this.cancelPending();
    const s = this.state.get();
    const canonical = this.deps.getCanonical();
    this.deps.setOverride(null);
    this.newSeries();
    this.state.set({ ...s, text: canonical, mode: 'blocks', reason: null, syntax: null, notice: null, discarded: s.text !== canonical ? s.text : s.discarded });
  }

  /** Verworfenen Entwurf zurückholen (spielt sofort wieder). */
  restoreDraft(): void {
    const draft = this.state.get().discarded;
    if (draft === null) return;
    this.state.setKey('discarded', null);
    this.edit(draft);
    this.afterApply(() => this.align(), true);
  }

  dismissNotice(): void {
    if (this.state.get().notice) this.state.setKey('notice', null);
  }

  /* ------------------------------- Ablauf ------------------------------- */

  private cancelPending(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    this.pending = null;
  }

  private newSeries(): void {
    this.deps.endSeries(this.series);
    this.series = `code-edit-${++this.seriesCount}`;
  }

  /** Wendet einen ausstehenden Text sofort an (Debounce überspringen). Promise, solange die Engine prüft. */
  flush(): Promise<void> | null {
    const text = this.pending;
    this.cancelPending();
    if (text !== null) return this.apply(text);
    return this.validating;
  }

  /**
   * Führt `fn` nach dem Anwenden aus – sofort oder nach der Engine-Prüfung, aber nur, wenn
   * der Text inzwischen nicht weiter bearbeitet wurde (und bei `whenBlurred` der Editor
   * nicht wieder fokussiert ist).
   */
  private afterApply(fn: () => void, whenBlurred: boolean): void {
    const pending = this.flush();
    if (!pending) {
      if (!(whenBlurred && this.focused)) fn();
      return;
    }
    const text = this.state.get().text;
    void pending.then(() => {
      if (this.state.get().text !== text || this.pending !== null) return;
      if (whenBlurred && this.focused) return;
      fn();
    });
  }

  private apply(text: string): Promise<void> | null {
    const s = this.state.get();
    const canonical = this.deps.getCanonical();
    if (text === canonical) {
      this.deps.setOverride(null);
      this.state.set({ ...s, mode: 'blocks', reason: null, syntax: null });
      return null;
    }
    // Code → Musik: genau dieser Text spielt (letztes gutes Pattern läuft bei Fehlern weiter)
    this.deps.setOverride(text);

    // Code → Bausteine
    let result: ImportResult;
    try {
      result = this.deps.importCode(text);
    } catch (err) {
      if (err instanceof ImportError && err.messageKey === 'importer.error.syntax') {
        const line = Number(err.params?.['line'] ?? 1);
        const column = Number(err.params?.['column'] ?? 0);
        const start = offsetOf(text, line, column);
        const end = Math.min(text.length, start + Math.max(1, /^[\w$]+/.exec(text.slice(start))?.[0].length ?? 1));
        const message = String(err.params?.['message'] ?? '');
        this.state.set({ ...this.state.get(), mode: 'codeMode', reason: 'syntax', syntax: { forText: text, start, end, line, column, message } });
      } else {
        const reason = err instanceof ImportError && err.messageKey === 'importer.error.noPattern' ? 'noPattern' : 'error';
        if (!(err instanceof ImportError)) console.warn('[LiveCode] Import fehlgeschlagen:', err);
        this.state.set({ ...this.state.get(), mode: 'codeMode', reason, syntax: null });
      }
      return null;
    }
    const verdict = this.deps.validate?.(text) ?? null;
    if (verdict) {
      const seq = ++this.applySeq;
      const run: Promise<void> = verdict
        .catch(() => null)
        .then((ok) => {
          if (seq !== this.applySeq || this.state.get().text !== text) return;
          this.finish(text, result, ok);
        })
        .finally(() => {
          if (this.validating === run) this.validating = null;
        });
      this.validating = run;
      return run;
    }
    this.finish(text, result, null);
    return null;
  }

  /** Übernahme in die Bausteine (nur wenn die Engine den Text nicht ablehnt). */
  private finish(text: string, result: ImportResult, accepted: boolean | null): void {
    if (accepted === false) {
      this.state.set({ ...this.state.get(), mode: 'codeMode', reason: 'runtime', syntax: null });
      return;
    }
    let kind: CodeSyncResult['kind'];
    try {
      kind = this.deps.sync(result, { series: this.series, hasTempo: /\bset(?:cpm|cps)\s*\(/i.test(text) });
    } catch (err) {
      console.warn('[LiveCode] Übernahme in die Bausteine fehlgeschlagen:', err);
      kind = 'unrepresentable';
    }
    if (kind === 'unrepresentable') {
      this.state.set({ ...this.state.get(), mode: 'codeMode', reason: 'arrangement', syntax: null });
      return;
    }
    this.lastSubstituted = result.stats.substituted;
    const nowCanonical = this.deps.getCanonical();
    if (text === nowCanonical) this.deps.setOverride(null);
    this.state.set({ ...this.state.get(), mode: text === nowCanonical ? 'blocks' : 'linked', reason: null, syntax: null, discarded: null });
  }

  private lastSubstituted = 0;

  /** Editor-Text → kanonischer kompilierter Code (nur wenn er in die Bausteine übernommen wurde). */
  private align(): void {
    const s = this.state.get();
    if (s.mode !== 'linked' && s.mode !== 'blocks') return;
    const canonical = this.deps.getCanonical();
    this.deps.setOverride(null);
    this.newSeries();
    const changed = s.text !== canonical;
    this.state.set({
      ...s,
      text: canonical,
      mode: 'blocks',
      reason: null,
      syntax: null,
      notice: changed && s.mode === 'linked' ? { kind: 'aligned', substituted: this.lastSubstituted } : s.notice,
    });
  }

  /** Bausteine → Code. */
  private onCanonical(): void {
    const s = this.state.get();
    const canonical = this.deps.getCanonical();
    if (s.mode === 'blocks') {
      if (s.text !== canonical) this.state.setKey('text', canonical);
      return;
    }
    if (s.text === canonical && this.pending === null) {
      this.deps.setOverride(null);
      this.state.set({ ...s, mode: 'blocks', reason: null, syntax: null });
      return;
    }
    // Fokussiert und schmutzig: Text des Nutzers nie überschreiben.
    if (this.focused) return;
    if (s.mode === 'codeMode') {
      this.cancelPending();
      this.deps.setOverride(null);
      this.newSeries();
      this.state.set({ ...s, text: canonical, mode: 'blocks', reason: null, syntax: null, notice: { kind: 'replaced' }, discarded: s.text });
      return;
    }
    this.afterApply(() => this.align(), true);
  }
}

/* ------------------------------------------------------------------ */
/* Instanz der App                                                     */
/* ------------------------------------------------------------------ */

let instance: LiveCode | null = null;

/** Live-Code des Code-Panels (Singleton, nur im Browser starten). */
export function liveCode(): LiveCode {
  instance ??= new LiveCode({
    getCanonical: () => compile(visualAstStore.get(), projectSettings.get()).code,
    subscribeCanonical: (cb) => compiledStrudelCode.listen(cb),
    importCode: (text) => importStrudelCode(text, { availableSounds: (projectSettings.get().samples ?? []).map((s) => s.name) }),
    sync: (result, options) => syncProjectFromCode(result, options),
    endSeries: endEditSeries,
    setOverride: (text) => {
      if (codeOverride.get() !== text) codeOverride.set(text);
    },
    validate: validateWithEngine,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });
  return instance;
}

/** Wie lange höchstens auf das Urteil der Engine gewartet wird. */
const VALIDATE_TIMEOUT_MS = 2500;

/**
 * Wartet auf die Evaluierung des Editor-Texts durch den AudioAgent (der Override löst sie
 * sofort aus – auch bei gestoppter, aber geladener Engine). null = Engine nicht geladen.
 */
function validateWithEngine(text: string): Promise<boolean | null> | null {
  if (playbackState.get().status !== 'ready') return null;
  const code = prepareCode(text) ?? text;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), VALIDATE_TIMEOUT_MS);
    const unsubscribe = lastEvaluation.listen((r) => {
      if (r?.code === code) finish(r.ok);
    });
    const last = lastEvaluation.get();
    if (last?.code === code) finish(last.ok);
  });
}
