/**
 * Audio-Agent („Die Strudel Engine“)
 *
 * Liest `compiledStrudelCode` und `transportCommand`, evaluiert den Code mit
 * @strudel/web und meldet den Zustand über `playbackState` zurück.
 *
 * - SSR-sicher: @strudel/web wird ausschließlich per dynamischem `import()` beim
 *   ersten Play geladen. Beim Import dieses Moduls passiert nichts Browser-Spezifisches.
 * - Zusatzpakete (xen, midi, motion, csound) lädt die Engine erst, wenn der Code sie
 *   verwendet (siehe strudelExtensions.ts).
 * - Autoplay-Policy: Der AudioContext wird synchron im transportCommand-Listener
 *   (= noch innerhalb der Klick-Geste der UI) erzeugt und `resume()`t. Engine und
 *   Samples laden danach asynchron und hängen sich an genau diesen Context.
 */
import type { InitAudioOptions, StrudelPattern, StrudelRepl } from '@strudel/web';
import { STRUDEL_FUNCTIONS, type StrudelFunctionStatus } from '../data/strudelFunctions';
import { languageStore, t, type TKey } from '../i18n';
import { withBase } from '../lib/paths';
import {
  activeLocations,
  codeErrorRange,
  codeOverride,
  compiledStrudelCode,
  lastEvaluation,
  outputAnalyser,
  playbackState,
  playingCode,
  projectEpoch,
  trackHits,
  transportCommand,
  uiState,
  type CodeRange,
  type PlaybackState,
  type TrackHit,
} from '../store/agentBus';
import { neededExtensions, type ExtensionId } from './strudelExtensions';
import { trackBlocksOf, trackHitsBetween, type TrackBlock } from './trackHits';

type StrudelWeb = typeof import('@strudel/web');

/* ------------------------------------------------------------------ */
/* Konfiguration                                                       */
/* ------------------------------------------------------------------ */

/** Throttle für Live-Updates (Slider-Drags): höchstens eine Evaluierung je Intervall. */
export const EVAL_THROTTLE_MS = 120;
/** Playhead-Aktualisierung ~30×/s. */
const PLAYHEAD_INTERVAL_MS = 1000 / 30;
/** Abbruch, falls eine Sample-Map nicht antwortet. */
const SAMPLE_TIMEOUT_MS = 20_000;

/**
 * Pfad der selbst gehosteten Samples (public/samples/). Alle Klänge stehen unter
 * freien Lizenzen mit eindeutigem Nachweis – siehe public/samples/CREDITS.md.
 * Es wird kein externes CDN angefragt.
 */
export const SAMPLES_PATH = withBase('samples');

/** Absolute URL des Ordners eines Sample-Sets, mit abschließendem „/“ (nur im Browser aufrufen). */
export function sampleBaseUrl(set: string, origin: string = window.location.origin): string {
  return `${origin}${SAMPLES_PATH}/${set}/`;
}

/** Absolute URL einer Sample-Map (nur im Browser aufrufen). */
export function sampleMapUrl(set: string, origin: string = window.location.origin): string {
  return `${sampleBaseUrl(set, origin)}strudel.json`;
}

/**
 * Registriert ein Sample-Set. Die Basis-URL wird explizit übergeben: superdough
 * leitet sie sonst ohne abschließendes „/“ aus der Map-URL ab.
 */
function loadSampleSet(mod: StrudelWeb, set: string, tag?: string): Promise<void> {
  return mod.samples(sampleMapUrl(set), sampleBaseUrl(set), tag ? { prebake: true, tag } : { prebake: true });
}

const AUDIO_OPTIONS: InitAudioOptions = { maxPolyphony: 128 };

export interface SampleSource {
  /** Auch Text-Key des Anzeigenamens (audio.sources.<id>). */
  id: 'drums' | 'piano' | 'sonicpi';
  /** Pflichtquelle? (Fällt alles Pflichtige aus → status 'error'.) */
  essential: boolean;
  load: (mod: StrudelWeb) => Promise<void>;
}

/**
 * Sample-Quellen. Die Sounds werden registriert, die Audiodateien selbst lädt
 * superdough erst beim ersten Anschlag (lazy). Basis-URL = Ordner der strudel.json.
 */
export const SAMPLE_SOURCES: readonly SampleSource[] = [
  {
    // Drum-Kits modern_*, analog_*, emu808_* → .bank("modern") …; ohne Bank: bd, sd, hh … (= modern)
    id: 'drums',
    essential: true,
    load: (mod) => loadSampleSet(mod, 'drums', 'drum-machines'),
  },
  {
    // Salamander Grand Piano → s("piano")
    id: 'piano',
    essential: true,
    load: (mod) => loadSampleSet(mod, 'piano'),
  },
  {
    // Sonic-Pi-Auswahl: tabla, elec, perc, glitch, bass, ambi, vinyl, misc
    id: 'sonicpi',
    essential: false,
    load: (mod) => loadSampleSet(mod, 'sonicpi'),
  },
];

/* ------------------------------------------------------------------ */
/* Reine Hilfsfunktionen (ohne Browser, getestet)                      */
/* ------------------------------------------------------------------ */

/**
 * Bereitet den Compiler-Code für `evaluate()` vor.
 * Liefert `null`, wenn nichts Ausführbares drinsteht (leer / nur Kommentare) → Stille.
 *
 * `$:`-Labels und `setcpm()` brauchen keine Umschreibung: der Strudel-Transpiler
 * macht aus `$: pat` → `pat.p('$')`, und `setcpm` wird vom REPL bei jeder
 * Evaluierung in den Scope injiziert.
 */
export function prepareCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const normalized = code.replace(/\r\n?/g, '\n');
  const withoutComments = normalized
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
  return withoutComments.trim() === '' ? null : normalized;
}

/**
 * Sucht zur (1-basierten) Zeile die Spur, zu der sie gehört: Der Compiler
 * schreibt vor jedes `$:` einen Kommentar `// <Spurname>`.
 */
export function findTrackName(code: string, line: number): string | null {
  const lines = code.replace(/\r\n?/g, '\n').split('\n');
  // Von der Fehlerzeile nach oben bis zum Kommentar der Spur; eine Leerzeile beendet den Block.
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
    const text = lines[i] ?? '';
    const comment = /^\s*\/\/\s*(.+?)\s*$/.exec(text);
    if (comment?.[1]) return comment[1];
    if (text.trim() === '') return null;
  }
  return null;
}

/**
 * Findet die Spur mit dem Syntaxfehler, indem jeder Block (durch Leerzeilen getrennt,
 * wie vom Compiler erzeugt) einzeln geparst wird – präziser als die Fehlerposition,
 * die bei fehlenden Klammern oft erst in einer späteren Spur liegt.
 * Es wird nur geparst, nicht ausgeführt.
 */
export function findBrokenTrack(code: string): string | null {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (body: string) => unknown;
  for (const block of code.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    if (!block.trim()) continue;
    try {
      new AsyncFunction(block);
    } catch {
      // Der Konstruktor wirft nur bei Syntaxfehlern. (Kein `instanceof SyntaxError`:
      // Strudels evalScope überschreibt globalThis.SyntaxError mit dem des Mini-Parsers.)
      return /^\s*\/\/\s*(.+?)\s*$/m.exec(block)?.[1] ?? null;
    }
  }
  return null;
}

/**
 * Fehler mit übersetzbarer Meldung: `render` liefert den Text in der jeweils
 * aktuellen Sprache (wird bei einem Sprachwechsel erneut aufgerufen).
 */
export class LocalizedError extends Error {
  constructor(readonly render: () => string) {
    super(render());
  }
}

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function errorLocation(err: unknown): { line: number; column: number } | null {
  if (typeof err === 'object' && err !== null && 'loc' in err) {
    const loc = (err as { loc?: unknown }).loc;
    if (typeof loc === 'object' && loc !== null) {
      const { line, column } = loc as { line?: unknown; column?: unknown };
      if (typeof line === 'number' && typeof column === 'number') return { line, column };
    }
  }
  const m = /\((\d+):(\d+)\)\s*$/.exec(rawMessage(err));
  if (m?.[1] && m[2]) return { line: Number(m[1]), column: Number(m[2]) };
  return null;
}

function describeSyntax(message: string): string | null {
  const msg = message.replace(/\s*\(\d+:\d+\)\s*$/, '');
  if (/^Unterminated string constant/.test(msg)) return t('audio.syntax.unterminatedString');
  if (/^Unterminated template/.test(msg)) return t('audio.syntax.unterminatedTemplate');
  if (/^Unterminated comment/.test(msg)) return t('audio.syntax.unterminatedComment');
  if (/^Unterminated regular expression/.test(msg)) return t('audio.syntax.unexpectedSlash');
  const ch = /^Unexpected character '(.+)'/.exec(msg);
  if (ch?.[1]) return t('audio.syntax.unexpectedCharacter', { char: ch[1] });
  if (/^Unexpected token/.test(msg)) return t('audio.syntax.unexpectedToken');
  const dup = /^Identifier '(.+)' has already been declared/.exec(msg);
  if (dup?.[1]) return t('audio.syntax.duplicateName', { name: dup[1] });
  return null;
}

let functionIndex: Map<string, StrudelFunctionStatus> | null = null;

/**
 * Klassifikation eines Namens (Hauptname oder Alias) aus der Funktionsliste von strudel.cc;
 * `undefined`, wenn der Name dort nicht vorkommt. Schreibweisen, die erst eine neuere
 * Strudel-Version kennt (`newerNames`), gelten als 'newer', auch wenn die Funktion bei uns läuft.
 */
export function lookupStrudelFunction(name: string): StrudelFunctionStatus | undefined {
  if (!functionIndex) {
    functionIndex = new Map();
    for (const fn of STRUDEL_FUNCTIONS) {
      for (const key of [fn.name, ...fn.aliases]) functionIndex.set(key, fn.status);
      for (const key of fn.newerNames ?? []) functionIndex.set(key, 'newer');
    }
  }
  return functionIndex.get(name);
}

/**
 * Fehlt ein Name, den es auf strudel.cc gibt? Dann sagen, warum – statt „Tippfehler?“.
 * (Klassifikation aus src/data/strudelFunctions.ts.)
 */
function describeMissingName(name: string): string | null {
  const status = lookupStrudelFunction(name);
  if (status === 'newer') return t('audio.newerFunction', { name });
  if (status === 'unsupported') {
    return /^osc/.test(name) ? t('audio.unsupported.osc', { name }) : t('audio.unsupported.other', { name });
  }
  return null;
}

function describeSound(sound: string): string {
  const sep = sound.indexOf('_');
  if (sep > 0) {
    const bank = sound.slice(0, sep);
    const name = sound.slice(sep + 1);
    return t('audio.soundNotInBank', { name, bank });
  }
  return t('audio.soundNotFound', { sound });
}

/**
 * Übersetzt Evaluations-/Laufzeitfehler von Strudel in eine lesbare Meldung (aktuelle Sprache).
 * `code` (optional) erlaubt, Syntaxfehler einer Spur zuzuordnen.
 */
export function describeError(err: unknown, code?: string): string {
  const message = rawMessage(err).trim();
  const name = err instanceof Error ? err.name : '';

  // Mini-Notation (Text in Anführungszeichen), Fehler aus dem krill-Parser
  const mini = /^\[mini\] parse error at line (\d+):\s*([\s\S]*)$/.exec(message);
  if (mini) {
    return t('audio.miniNotation', { detail: mini[2]?.trim() ?? '' }).trim();
  }

  const sound = /sound (.+?) not found! Is it loaded\?/.exec(message);
  if (sound?.[1]) return describeSound(sound[1]);

  const sampler = /could not load "(.+?)"/.exec(message);
  if (sampler?.[1]) return t('audio.sampleNotLoaded', { sample: sampler[1] });

  if (name === 'TimeoutError' || /error loading "|Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return t('audio.soundsNotLoaded');
  }

  const syntax = name === 'SyntaxError' || /^(Unexpected|Unterminated)/.test(message) ? describeSyntax(message) : null;
  if (syntax !== null || name === 'SyntaxError') {
    const loc = errorLocation(err);
    const track = code ? (findBrokenTrack(code) ?? (loc ? findTrackName(code, loc.line) : null)) : null;
    const where = track ? t('audio.inTrack', { track }) : loc ? t('audio.inLine', { line: loc.line }) : '';
    return t('audio.syntaxError', { where, detail: syntax ?? message });
  }

  const notDefined = /^([\w$]+) is not defined/.exec(message);
  if (notDefined?.[1]) return describeMissingName(notDefined[1]) ?? t('audio.unknownName', { name: notDefined[1] });

  const notFunction = /([\w$]+) is not a function/.exec(message);
  if (notFunction?.[1]) return describeMissingName(notFunction[1]) ?? t('audio.notAFunction', { name: notFunction[1] });

  if (/Cannot read propert|undefined is not an object|is not an object/.test(message)) {
    return t('audio.invalidExpression', { detail: message });
  }

  return message ? t('audio.codeError', { detail: message }) : t('audio.unknownError');
}

/**
 * Wertet eine `strudel.log`-Meldung aus. Liefert die Fehlermeldung, wenn es sich
 * um einen Laufzeitfehler handelt (unbekannter Sound, Scheduler-Fehler …), sonst `null`.
 * Evaluationsfehler (`[eval] …`) werden separat über onEvalError behandelt.
 */
/**
 * Harmlose Laufzeitmeldungen, die Strudel selbst nur ins Log schreibt: Ein
 * Sidechain (`.duck(n)`) zielt beim Start auf einen Orbit, den superdough erst mit
 * der ersten Note darauf anlegt – nur das allererste Ducking entfällt.
 */
const TRANSIENT_LOG = [/^duck target orbit \S+ does not exist$/];

export function parseStrudelLog(message: unknown): string | null {
  if (typeof message !== 'string') return null;
  const m = /^\[([\w-]+)\] error: ([\s\S]*)$/.exec(message);
  if (m) {
    const text = (m[2] ?? '').trim();
    if (m[1] === 'eval' || TRANSIENT_LOG.some((re) => re.test(text))) return null;
    return text || null;
  }
  if (/^\[sampler\] could not load/.test(message)) return message;
  return null;
}

/**
 * Welcher Text gespielt wird: der Editor-Override (Nutzer tippt im Code-Panel) hat
 * Vorrang vor dem kompilierten Code der Bausteine.
 */
export function selectEvalSource(compiled: string, override: string | null): string {
  return override ?? compiled;
}

/**
 * Stelle eines Evaluationsfehlers im evaluierten Text (für die Markierung im Editor):
 * Syntaxfehler des JS-Parsers (`pos`), Mini-Notation (ganze Zeile). Sonst null.
 */
export function errorRangeOf(err: unknown, code: string): CodeRange | null {
  if (typeof err === 'object' && err !== null && 'pos' in err) {
    const pos = (err as { pos?: unknown }).pos;
    if (typeof pos === 'number' && pos >= 0 && pos <= code.length) {
      const word = /^[\w$]+/.exec(code.slice(pos))?.[0].length ?? 1;
      return { start: pos, end: Math.min(code.length, pos + Math.max(1, word)) };
    }
  }
  const mini = /^\[mini\] parse error at line (\d+)/.exec(rawMessage(err).trim());
  const loc = mini ? { line: Number(mini[1]) } : errorLocation(err);
  if (loc && loc.line >= 1) {
    const lines = code.split('\n');
    if (loc.line > lines.length) return null;
    const start = lines.slice(0, loc.line - 1).reduce((n, l) => n + l.length + 1, 0);
    const text = lines[loc.line - 1] ?? '';
    const lead = text.length - text.trimStart().length;
    return { start: start + lead, end: start + Math.max(lead + 1, text.trimEnd().length) };
  }
  return null;
}

interface LocatedHap {
  whole?: { begin: { valueOf(): number }; end: { valueOf(): number } } | null;
  context?: { locations?: Array<{ start: number; end: number }> };
}

/**
 * Highlighter: Positionen (`hap.context.locations`) aller Haps, die zum Zyklus `cycle`
 * gerade klingen (Onset ≤ cycle < Ende). `allowed` (Schlüssel „start:end“, aus den
 * Mini-Positionen des Transpilers) filtert Positionen heraus, die nicht zum Quelltext
 * gehören (z. B. erst zur Laufzeit geparste Strings). Sortiert, ohne Duplikate.
 */
export function activeRangesAt(
  pattern: { queryArc(begin: number, end: number, controls?: Record<string, unknown>): unknown[] },
  cycle: number,
  allowed?: ReadonlySet<string> | null,
  controls?: Record<string, unknown>,
): CodeRange[] {
  const haps = pattern.queryArc(cycle, cycle + 1e-6, controls) as LocatedHap[];
  const seen = new Set<string>();
  const out: CodeRange[] = [];
  for (const hap of haps) {
    const whole = hap.whole;
    if (!whole || whole.begin.valueOf() > cycle || whole.end.valueOf() <= cycle) continue;
    for (const loc of hap.context?.locations ?? []) {
      const key = `${loc.start}:${loc.end}`;
      if (seen.has(key) || (allowed && !allowed.has(key))) continue;
      seen.add(key);
      out.push({ start: loc.start, end: loc.end });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/* ------------------------------------------------------------------ */
/* Laufzeit-Zustand (nur im Browser)                                   */
/* ------------------------------------------------------------------ */

interface Engine {
  mod: StrudelWeb;
  repl: StrudelRepl;
  /** Bereits geladene Zusatzpakete (xen, midi, motion, csound). */
  extensions: Set<ExtensionId>;
}

let started = false;
let audioCtx: AudioContext | null = null;
let engine: Engine | null = null;
let enginePromise: Promise<Engine> | null = null;
const loadedSamples = new Set<string>();

/** Soll gerade gespielt werden? (Transport-Wunsch, auch während des Ladens.) */
let wantPlaying = false;
/** Erhöht sich bei jedem Play/Stop – veraltete async-Fortsetzungen brechen ab. */
let transportToken = 0;

let evalTimer: ReturnType<typeof setTimeout> | null = null;
let evaluating = false;
let evalQueued = false;
/** Code, der gerade (bzw. zuletzt) evaluiert wurde – für Fehlerzuordnung. */
let lastCode = '';

let rafId: number | null = null;
let lastPlayheadUpdate = 0;

/** Zuletzt versuchter Quelltext – identischer Text wird bei Store-Änderungen nicht erneut evaluiert. */
let lastAttempted: string | null = null;
/** Mini-Positionen des Transpilers für den gerade spielenden Code (Schlüssel „start:end“). */
let miniLocations: { code: string; keys: Set<string> } | null = null;
/** Schlüssel der zuletzt veröffentlichten Highlighter-Positionen (nur bei Änderung neu setzen). */
let lastLocationsKey = '';
/** Spurblöcke des zuletzt evaluierten Codes – ordnen Hap-Positionen einer Spur zu. */
let trackBlocks: TrackBlock[] = [];
/** Zyklus des letzten Anschlag-Ticks (−1 = neu beginnen). */
let lastHitCycle = -1;

/** Fehlermeldung als Funktion: liefert den Text in der aktuellen Sprache. */
type ErrorText = (() => string) | null;

/** Aktuelle Fehlermeldung – wird bei einem Sprachwechsel neu erzeugt. */
let errorText: ErrorText = null;

type StatePatch = Partial<Omit<PlaybackState, 'error'>> & { error?: ErrorText };

/** Schreibt nur geänderte Felder (eine Benachrichtigung pro Aufruf). */
function setState({ error, ...rest }: StatePatch): void {
  const patch: Partial<PlaybackState> = rest;
  if (error !== undefined) {
    errorText = error;
    patch.error = error ? error() : null;
  }
  const current = playbackState.get();
  const changed = (Object.keys(patch) as (keyof PlaybackState)[]).some((key) => current[key] !== patch[key]);
  if (changed) playbackState.set({ ...current, ...patch });
}

/** Meldung eines gefangenen Fehlers (übersetzbar, falls LocalizedError). */
function errorTextOf(err: unknown): () => string {
  return err instanceof LocalizedError ? err.render : () => rawMessage(err);
}

/** Wirft mit Text aus audio.json (aktuelle Sprache, bei Sprachwechsel neu). */
function localizedError(key: TKey, params?: Record<string, string | number>): LocalizedError {
  return new LocalizedError(() => t(key, params));
}

/* ---------------------------- AudioContext ---------------------------- */

/** Synchron in der User-Geste aufrufen: Context anlegen bzw. fortsetzen. */
function unlockAudioContext(): AudioContext {
  if (!audioCtx) {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) throw localizedError('audio.noWebAudio');
    audioCtx = new Ctor();
  }
  const ctx = audioCtx;
  if (ctx.state !== 'running') {
    void ctx.resume().catch(() => {});
    // iOS/Safari: ein stummer Mini-Buffer innerhalb der Geste entsperrt die Ausgabe zuverlässig.
    try {
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* egal */
    }
  }
  return ctx;
}

/* ------------------------------ Engine ------------------------------ */

function onEvalError(err: unknown): void {
  const code = lastCode;
  setState({ error: () => describeError(err, code) });
  const range = errorRangeOf(err, code);
  codeErrorRange.set(range ? { code, ...range } : null);
}

/** Nach erfolgreicher Evaluierung (Strudel-REPL `afterEval`): was spielt, wo stehen die Mini-Atome? */
function onAfterEval({ code, meta }: { code: string; meta?: { miniLocations?: unknown } }): void {
  const locs = Array.isArray(meta?.miniLocations) ? (meta.miniLocations as unknown[]) : [];
  const keys = new Set<string>();
  for (const l of locs) if (Array.isArray(l) && typeof l[0] === 'number' && typeof l[1] === 'number') keys.add(`${l[0]}:${l[1]}`);
  miniLocations = { code, keys };
  trackBlocks = trackBlocksOf(code);
  playingCode.set(code);
  if (codeErrorRange.get()) codeErrorRange.set(null);
}

/**
 * Wird von Strudel in setPattern() aufgerufen (innerhalb des try/catch von evaluate).
 * Probe-Abfrage des neuen Patterns über `query()` (wirft – im Gegensatz zu `queryArc()`,
 * das Fehler verschluckt und still wird). Wirft sie, schlägt die Evaluierung fehl und
 * das zuletzt funktionierende Pattern läuft weiter.
 */
function probePattern(pattern: StrudelPattern): StrudelPattern {
  const eng = engine;
  if (!eng) return pattern;
  const { scheduler } = eng.repl;
  const begin = Math.max(0, scheduler.now());
  const { State, TimeSpan } = eng.mod;
  pattern.query(new State(new TimeSpan(begin, begin + 1), { _cps: scheduler.cps }));
  return pattern;
}

function onStrudelLog(event: Event): void {
  if (!wantPlaying) return;
  const detail = (event as CustomEvent<{ message?: unknown }>).detail;
  const msg = parseStrudelLog(detail?.message);
  if (!msg) return;
  if (/AudioWorklet/.test(msg)) {
    // Kein Fehler im Code: Dem AudioContext fehlen die Worklets (supersaw, crush, shape …)
    setState({ error: workletErrorText() });
    return;
  }
  const code = lastCode;
  setState({ error: () => describeError(new Error(msg), code) });
}

/**
 * Chromium/Firefox bieten `audioContext.audioWorklet` nur in einem sicheren Kontext
 * (HTTPS oder localhost). Ohne Worklets fehlen supersaw und die Effekte crush,
 * coarse, shape, distort, djf …
 */
function workletsAvailable(ctx: AudioContext): boolean {
  return typeof (ctx as { audioWorklet?: unknown }).audioWorklet === 'object' && ctx.audioWorklet !== null;
}

function workletErrorText(): () => string {
  return window.isSecureContext ? () => t('audio.workletsFailed') : () => t('audio.workletsInsecure', { origin: location.origin });
}

async function createEngine(ctx: AudioContext): Promise<Engine> {
  // Quelle statt Komplett-Bundle: core/mini/tonal/webaudio kommen so als eigene Module –
  // dieselbe Instanz, die auch die Zusatzpakete (xen, midi …) importieren.
  const mod: StrudelWeb = await import('@strudel/web/web.mjs');
  // Vor allem anderen: superdough soll unseren (bereits entsperrten) Context benutzen.
  mod.setAudioContext(ctx);
  // Registriert den Erst-Klick-Listener von superdough mit unseren Optionen (wird gecacht);
  // initStrudel() ruft ihn erneut auf und bekommt dann denselben Promise.
  void mod.initAudioOnFirstClick(AUDIO_OPTIONS);
  const replPromise = mod.initStrudel({
    audioContext: ctx,
    onEvalError,
    editPattern: probePattern,
    afterEval: onAfterEval,
  });
  // Worklets (supersaw, crush, shape/distort …) sofort laden – nicht erst beim nächsten mousedown.
  // Ohne audioWorklet (unsicherer Kontext) gar nicht erst versuchen – sonst nur eine Konsolen-Warnung.
  const [repl] = await Promise.all([
    replPromise,
    mod.initAudio(workletsAvailable(ctx) ? AUDIO_OPTIONS : { ...AUDIO_OPTIONS, disableWorklets: true }),
  ]);
  if (!workletsAvailable(ctx)) console.warn('[AudioAgent] AudioWorklets nicht verfügbar (kein sicherer Kontext?):', location.origin);
  installReplShims(mod);
  document.addEventListener('strudel.log', onStrudelLog);
  const eng: Engine = { mod, repl, extensions: new Set() };
  tapOutput(eng);
  return eng;
}

/** Analyser für den Visualizer – einer für die ganze Sitzung, wird nach jedem Reset neu angehängt. */
let analyser: AnalyserNode | null = null;

/**
 * Hängt den Analyser an den Master-Ausgang von superdough. Muss nach jedem
 * `resetGlobalEffects()` erneut laufen, weil superdough den Ausgang dabei neu anlegt.
 */
function tapOutput(eng: Engine): void {
  try {
    const master = eng.mod.getSuperdoughAudioController().output.destinationGain;
    if (!master) return;
    analyser ??= new AnalyserNode(master.context, { fftSize: 2048, smoothingTimeConstant: 0.75 });
    master.connect(analyser);
    outputAnalyser.set(analyser);
  } catch (err) {
    console.warn('[AudioAgent] Visualizer-Analyser nicht angeschlossen:', err);
  }
}

/* --------------------------- Zusatzpakete --------------------------- */

type MotionModule = typeof import('@strudel/motion/motion.mjs');

/** @strudel/motion, sobald geladen (für die Sensor-Freigabe beim nächsten Klick). */
let motionModule: MotionModule | null = null;
let motionAskedInGesture = false;

/**
 * iOS/Safari geben Bewegungssensoren nur nach einer Abfrage innerhalb einer Nutzeraktion frei.
 * Wird synchron im Play-Klick aufgerufen – einmalig, sobald @strudel/motion geladen ist.
 */
function enableMotionInGesture(): void {
  if (!motionModule || motionAskedInGesture) return;
  const motionEvent = (window as { DeviceMotionEvent?: { requestPermission?: unknown } }).DeviceMotionEvent;
  if (typeof motionEvent?.requestPermission !== 'function') return;
  motionAskedInGesture = true;
  void motionModule.enableMotion().catch(() => {});
}

/**
 * Lädt die Zusatzpakete, die der Code verwendet, und nimmt sie in den Strudel-Scope auf.
 * Wirft (übersetzbar), wenn eines nicht geladen werden kann.
 */
async function loadExtensions(eng: Engine, code: string): Promise<void> {
  const missing = neededExtensions(code).filter((ext) => !eng.extensions.has(ext.id));
  if (!missing.length) return;
  const results = await Promise.allSettled(
    missing.map(async (ext) => {
      const exports = await ext.load();
      await eng.mod.evalScope(exports);
      eng.extensions.add(ext.id);
      if (ext.id === 'motion') {
        motionModule = exports as MotionModule;
        // Android/Desktop: sofort; iOS braucht dafür einen Klick (enableMotionInGesture).
        void motionModule.enableMotion().catch(() => {});
      }
    }),
  );
  const failed = missing.filter((_, i) => results[i]?.status === 'rejected');
  if (failed.length) {
    results.forEach((r) => r.status === 'rejected' && console.warn('[AudioAgent] Zusatzpaket nicht geladen:', r.reason));
    throw localizedError('audio.extensionNotLoaded', { pkg: failed.map((ext) => ext.pkg).join(', ') });
  }
}

/**
 * Visualisierungen und Widgets des strudel.cc-Editors (Pianoroll, Scope, Slider …)
 * erzeugen keinen Ton. Damit Code von dort trotzdem läuft, werden sie zu No-ops:
 * Pattern-Methoden geben das Pattern unverändert zurück, `slider(wert, …)` liefert
 * seinen Startwert (auch als sliderWithID).
 *
 * Auch vorhandene Implementierungen (aus @strudel/draw bzw. @strudel/webaudio) werden
 * ersetzt: Sie zeichnen auf eine bildschirmfüllende Canvas, die über der Oberfläche läge.
 * Inline-Varianten (`_pianoroll` …) erscheinen auf strudel.cc im Editor und fehlen hier ganz.
 */
export const VISUAL_METHODS = [
  // @strudel/draw
  'pianoroll',
  'punchcard',
  'wordfall',
  'spiral',
  'pitchwheel',
  'draw',
  'animate',
  // @strudel/webaudio (Analyser-Darstellungen)
  'scope',
  'tscope',
  'fscope',
  'spectrum',
  // Editor von strudel.cc (Zeilen-CSS, Farbschema)
  'markcss',
  'theme',
] as const;

export function installReplShims(mod: unknown, scope: Record<string, unknown> = globalThis as Record<string, unknown>): void {
  const proto = (mod as { Pattern?: { prototype: Record<string, unknown> } }).Pattern?.prototype;
  if (proto) {
    for (const name of VISUAL_METHODS) {
      for (const key of [name, `_${name}`]) {
        proto[key] = function (this: unknown) {
          return this;
        };
      }
    }
  }
  if (typeof scope.slider !== 'function') scope.slider = (value: unknown) => value;
  // Der Transpiler schreibt slider(…) zu sliderWithID(id, wert, min?, max?) um.
  if (typeof scope.sliderWithID !== 'function') scope.sliderWithID = (_id: unknown, value: unknown) => value;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(t('audio.timeout'));
      err.name = 'TimeoutError';
      reject(err);
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Lädt alle noch fehlenden Sample-Quellen. Liefert die fehlgeschlagenen Pflichtquellen. */
async function loadSamples(mod: StrudelWeb): Promise<SampleSource[]> {
  const pending = SAMPLE_SOURCES.filter((s) => !loadedSamples.has(s.id));
  const results = await Promise.allSettled(pending.map((s) => withTimeout(s.load(mod), SAMPLE_TIMEOUT_MS)));
  const failed: SampleSource[] = [];
  results.forEach((result, i) => {
    const source = pending[i];
    if (!source) return;
    if (result.status === 'fulfilled') loadedSamples.add(source.id);
    else {
      console.warn(`[AudioAgent] Samples „${source.id}“ nicht geladen:`, result.reason);
      if (source.essential) failed.push(source);
    }
  });
  return failed;
}

function allSamplesLoaded(): boolean {
  return SAMPLE_SOURCES.every((s) => loadedSamples.has(s.id));
}

function essentialSampleCount(): number {
  return SAMPLE_SOURCES.filter((s) => s.essential).length;
}

/**
 * Engine + Samples bereitstellen. Wirft bei fatalen Fehlern (Engine nicht ladbar
 * oder sämtliche Samples fehlen). Fehlgeschlagenes wird beim nächsten Play erneut versucht.
 */
async function ensureReady(ctx: AudioContext): Promise<Engine> {
  if (engine && allSamplesLoaded()) return engine;
  setState({ status: 'loading', error: null });

  enginePromise ??= createEngine(ctx).catch((err: unknown) => {
    enginePromise = null;
    throw err;
  });
  let eng: Engine;
  try {
    eng = await enginePromise;
  } catch (err) {
    console.error('[AudioAgent] Engine-Init fehlgeschlagen:', err);
    const detail = rawMessage(err);
    throw /fetch|import|module/i.test(detail)
      ? localizedError('audio.engineNotLoaded')
      : localizedError('audio.engineNotStarted', { detail });
  }
  engine = eng;

  const failed = await loadSamples(eng.mod);
  if (failed.length >= essentialSampleCount()) {
    throw localizedError('audio.samplesNotLoaded');
  }
  setState({
    status: 'ready',
    error: failed.length
      ? () => t('audio.someSoundsMissing', { sources: failed.map((s) => t(`audio.sources.${s.id}`)).join(', ') })
      : null,
  });
  return eng;
}

/* ---------------------------- Evaluierung ---------------------------- */

/** Aktueller Quelltext: Editor-Override oder kompilierter Code. */
function currentSource(): string {
  return selectEvalSource(compiledStrudelCode.get(), codeOverride.get());
}

async function evaluateCurrent(eng: Engine): Promise<void> {
  const code = currentSource();
  const prepared = prepareCode(code);
  lastCode = prepared ?? code;
  lastAttempted = code;
  const report = (ok: boolean) => lastEvaluation.set({ code: prepared ?? code, ok });
  if (prepared === null) {
    // Nichts zu spielen (z. B. alle Spuren stumm) → Stille, Transport läuft weiter.
    await eng.repl.setPattern(eng.mod.silence, false);
    miniLocations = null;
    trackBlocks = [];
    playingCode.set(code);
    codeErrorRange.set(null);
    setState({ error: null });
    report(true);
    return;
  }
  try {
    await loadExtensions(eng, prepared);
  } catch (err) {
    // Altes Pattern läuft weiter; beim nächsten Code-Update/Play wird erneut geladen.
    setState({ error: errorTextOf(err) });
    report(false);
    return;
  }
  try {
    const pattern = await eng.repl.evaluate(prepared, false);
    // Bei Fehlern liefert evaluate() undefined, onEvalError hat die Meldung bereits gesetzt
    // und der Scheduler spielt das bisherige Pattern weiter.
    if (pattern) setState({ error: null });
    report(!!pattern);
  } catch (err) {
    onEvalError(err);
    report(false);
  }
}

/** Laufende Evaluierungsschleife (für Aufrufer, die auf den neuesten Code warten müssen). */
let evaluationRun: Promise<void> | null = null;

/**
 * Serialisierte Evaluierung: nie zwei gleichzeitig, am Ende immer der neueste Code.
 * Läuft schon eine, wird nachgereiht; das Promise erfüllt sich erst danach.
 */
function runEvaluation(): Promise<void> {
  const eng = engine;
  if (!eng) return Promise.resolve();
  if (evaluating) {
    evalQueued = true;
    return evaluationRun ?? Promise.resolve();
  }
  evaluating = true;
  evaluationRun = (async () => {
    try {
      do {
        evalQueued = false;
        await evaluateCurrent(eng);
      } while (evalQueued && (wantPlaying || codeOverride.get() !== null));
    } finally {
      evaluating = false;
      evaluationRun = null;
    }
  })();
  return evaluationRun;
}

function scheduleEvaluation(): void {
  if (!wantPlaying || !engine || evalTimer !== null) return;
  // Throttle mit nachlaufender Ausführung: der Code wird erst beim Feuern gelesen,
  // d. h. bei Slider-Drags max. ~8 Evaluierungen/s und der Endwert kommt immer an.
  evalTimer = setTimeout(() => {
    evalTimer = null;
    if (wantPlaying) void runEvaluation();
  }, EVAL_THROTTLE_MS);
}

function cancelScheduledEvaluation(): void {
  if (evalTimer !== null) {
    clearTimeout(evalTimer);
    evalTimer = null;
  }
}

/* ------------------------------ Playhead ------------------------------ */

function playheadLoop(ts: number): void {
  const eng = engine;
  if (!wantPlaying || !eng) {
    rafId = null;
    return;
  }
  if (ts - lastPlayheadUpdate >= PLAYHEAD_INTERVAL_MS) {
    lastPlayheadUpdate = ts;
    const cycle = eng.repl.scheduler.now();
    setState({ currentCycle: Number.isFinite(cycle) ? Math.max(0, cycle) : 0 });
    updateActiveLocations(eng, cycle);
    // nur, solange jemand zuhört (Visualizer an)
    if (trackHits.lc > 0) publishTrackHits(eng, cycle);
  }
  rafId = requestAnimationFrame(playheadLoop);
}

/** Visualizer: welche Spuren seit dem letzten Tick angeschlagen haben. */
function publishTrackHits(eng: Engine, cycle: number): void {
  const pattern = eng.repl.scheduler.pattern;
  if (!pattern || !Number.isFinite(cycle) || cycle < 0) return;
  // Erster Tick, Neustart oder Sprung (Tab im Hintergrund): Fenster neu beginnen
  if (lastHitCycle < 0 || cycle < lastHitCycle || cycle - lastHitCycle > 1) {
    lastHitCycle = cycle;
    return;
  }
  let hits: TrackHit[] = [];
  try {
    hits = trackHitsBetween(pattern, lastHitCycle, cycle, trackBlocks, { _cps: eng.repl.scheduler.cps });
  } catch {
    /* Abfragefehler: dieser Tick ohne Anschläge */
  }
  lastHitCycle = cycle;
  if (hits.length) trackHits.set({ hits });
}

/** Highlighter: gerade klingende Mini-Atome veröffentlichen (nur bei offenem Code-Panel, nur bei Änderung). */
function updateActiveLocations(eng: Engine, cycle: number): void {
  const pattern = eng.repl.scheduler.pattern;
  const locs = miniLocations;
  if (!uiState.get().codePanelOpen || !pattern || !locs || !Number.isFinite(cycle) || cycle < 0) {
    clearActiveLocations();
    return;
  }
  let ranges: CodeRange[];
  try {
    ranges = activeRangesAt(pattern, cycle, locs.keys, { _cps: eng.repl.scheduler.cps });
  } catch {
    ranges = [];
  }
  const key = `${locs.code.length}|${ranges.map((r) => `${r.start}:${r.end}`).join(',')}`;
  if (key === lastLocationsKey && activeLocations.get().code === locs.code) return;
  lastLocationsKey = key;
  activeLocations.set({ code: locs.code, ranges });
}

function clearActiveLocations(): void {
  if (activeLocations.get().ranges.length === 0) return;
  lastLocationsKey = '';
  activeLocations.set({ code: '', ranges: [] });
}

function startPlayhead(): void {
  if (rafId !== null) return;
  lastPlayheadUpdate = 0;
  lastHitCycle = -1;
  rafId = requestAnimationFrame(playheadLoop);
}

function stopPlayhead(): void {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
}

/* ------------------------------ Transport ------------------------------ */

function play(): void {
  const token = ++transportToken;
  wantPlaying = true;

  let ctx: AudioContext;
  try {
    // Synchron, noch innerhalb der Klick-Geste der UI.
    ctx = unlockAudioContext();
    enableMotionInGesture();
  } catch (err) {
    wantPlaying = false;
    setState({ status: 'error', error: errorTextOf(err), isPlaying: false });
    return;
  }

  // Frischer Start: Nachhall, Echo und vorausgeplante Töne des letzten Durchlaufs abschneiden –
  // sonst überlagern sie sich bei schnellem Stop/Play-Wechsel zu Interferenzen.
  if (engine && !engine.repl.scheduler.started) cutTails(engine);

  void (async () => {
    try {
      const eng = await ensureReady(ctx);
      if (token !== transportToken || !wantPlaying) return;
      if (ctx.state !== 'running') await ctx.resume().catch(() => {});

      cancelScheduledEvaluation();
      await runEvaluation();
      if (token !== transportToken || !wantPlaying) return;

      const { scheduler } = eng.repl;
      // Noch nie ein gültiges Pattern (z. B. Syntaxfehler beim ersten Play) → mit Stille starten,
      // damit Transport/Playhead laufen und die Korrektur sofort hörbar wird.
      if (!scheduler.pattern) await eng.repl.setPattern(eng.mod.silence, false);
      if (!scheduler.started) await eng.repl.start();
      if (token !== transportToken || !wantPlaying) {
        eng.repl.stop();
        return;
      }
      setState({ isPlaying: true });
      startPlayhead();
    } catch (err) {
      if (token !== transportToken) return;
      wantPlaying = false;
      setState({ status: 'error', error: errorTextOf(err), isPlaying: false, currentCycle: 0 });
    }
  })();
}

function stop(): void {
  transportToken++;
  wantPlaying = false;
  cancelScheduledEvaluation();
  stopPlayhead();
  clearActiveLocations();
  try {
    engine?.repl.stop();
  } catch (err) {
    console.warn('[AudioAgent] Stop fehlgeschlagen:', err);
  }
  setState({ isPlaying: false, currentCycle: 0 });
}

/**
 * Schneidet alles ab, was noch klingt: Nachhall, Echo und ausklingende Töne hängen
 * an den Orbit-Knoten von superdough – die werden getrennt und beim nächsten Ton neu angelegt.
 */
function cutTails(eng: Engine): void {
  try {
    eng.mod.resetGlobalEffects();
  } catch (err) {
    console.warn('[AudioAgent] Ausklang nicht abgeschnitten:', err);
  }
  tapOutput(eng);
}

/**
 * Anderes Projekt geladen: Ausklang des alten abschneiden und – falls gerade
 * gespielt wird – das neue von Zyklus 0 an starten (ohne Transport-Stopp in der UI).
 */
function onProjectLoaded(): void {
  const eng = engine;
  if (!eng) return;
  cancelScheduledEvaluation();
  if (!wantPlaying) {
    cutTails(eng);
    return;
  }
  const token = ++transportToken;
  stopPlayhead();
  clearActiveLocations();
  eng.repl.stop();
  cutTails(eng);
  setState({ currentCycle: 0 });
  void (async () => {
    try {
      // Der CompilerAgent kompiliert per Microtask – erst danach liegt der neue Code vor.
      await Promise.resolve();
      await runEvaluation();
      if (token !== transportToken || !wantPlaying) return;
      if (!eng.repl.scheduler.pattern) await eng.repl.setPattern(eng.mod.silence, false);
      await eng.repl.start();
      if (token !== transportToken || !wantPlaying) {
        eng.repl.stop();
        return;
      }
      startPlayhead();
    } catch (err) {
      if (token !== transportToken) return;
      wantPlaying = false;
      setState({ status: 'error', error: errorTextOf(err), isPlaying: false, currentCycle: 0 });
    }
  })();
}

/* ------------------------------ Einstieg ------------------------------ */

/** Nur im Browser aufrufen. Abonniert transportCommand/compiledStrudelCode, schreibt playbackState. Idempotent. */
export function startAudioAgent(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  // nanostores-Listener laufen synchron → wir sind hier noch in der User-Geste.
  transportCommand.listen((cmd) => {
    if (!cmd) return;
    if (cmd.action === 'play') play();
    else stop();
  });

  compiledStrudelCode.listen(() => {
    // Spielt gerade der Editor-Text, ändert ein neuer kompilierter Code nichts am Klang.
    if (wantPlaying && engine && currentSource() !== lastAttempted) scheduleEvaluation();
  });

  // Editor-Override (Tippen im Code-Panel, bereits entprellt) → sofort anwenden, ohne Stopp.
  // Auch bei gestoppter (aber geladener) Engine: Der Editor erfährt so sofort, ob der Text läuft.
  codeOverride.listen(() => {
    if (!engine || currentSource() === lastAttempted) return;
    cancelScheduledEvaluation();
    void runEvaluation();
  });

  // Neues Projekt: Ausklang abschneiden, von vorne spielen.
  projectEpoch.listen(onProjectLoaded);
  // Sprachwechsel: aktuelle Fehlermeldung in der neuen Sprache anzeigen.
  languageStore.listen(() => {
    const render = errorText;
    if (render) setState({ error: render });
  });
}
