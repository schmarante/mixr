/**
 * Minimale Typdeklarationen für @strudel/web 1.3 (das Paket liefert keine eigenen Typen).
 * Enthält nur das, was der AudioAgent tatsächlich nutzt.
 *
 * Der AudioAgent lädt `@strudel/web/web.mjs` (die Quelle, die core/mini/tonal/webaudio als
 * eigene Pakete importiert) statt des Komplett-Bundles `@strudel/web` – nur so teilen sich
 * Engine und Zusatzpakete (xen, midi, motion, csound) eine @strudel/core-Instanz.
 */
declare module '@strudel/web' {
  export interface StrudelPattern {
    /** Fängt Fehler intern ab (loggt „[query] error“) und liefert dann []. */
    queryArc(begin: number, end: number, controls?: Record<string, unknown>): unknown[];
    /** Rohe Abfrage – wirft bei Fehlern. */
    query(state: State): unknown[];
  }

  export class TimeSpan {
    constructor(begin: number, end: number);
  }

  export class State {
    constructor(span: TimeSpan, controls?: Record<string, unknown>);
  }

  export interface StrudelScheduler {
    started: boolean;
    cps: number;
    pattern?: StrudelPattern;
    /** Aktuelle Zyklusposition (0, solange gestoppt). */
    now(): number;
  }

  export interface StrudelRepl {
    scheduler: StrudelScheduler;
    /** Fängt Fehler intern ab (→ onEvalError) und liefert dann `undefined`. */
    evaluate(code: string, autostart?: boolean, shouldHush?: boolean): Promise<StrudelPattern | undefined>;
    setPattern(pattern: StrudelPattern, autostart?: boolean): Promise<StrudelPattern>;
    start(): Promise<void>;
    stop(): void;
  }

  export interface InitStrudelOptions {
    audioContext?: AudioContext;
    prebake?: () => unknown;
    onEvalError?: (err: unknown) => void;
    editPattern?: (pattern: StrudelPattern) => StrudelPattern | undefined;
    /** Nach jeder erfolgreichen Evaluierung: Code + Transpiler-Metadaten (u. a. `miniLocations`). */
    afterEval?: (info: { code: string; pattern: StrudelPattern; meta?: { miniLocations?: unknown } }) => void;
    miniAllStrings?: boolean;
  }

  export interface InitAudioOptions {
    maxPolyphony?: number;
    disableWorklets?: boolean;
  }

  export interface SamplesOptions {
    prebake?: boolean;
    tag?: string;
  }

  export function initStrudel(options?: InitStrudelOptions): Promise<StrudelRepl>;
  export function initAudio(options?: InitAudioOptions): Promise<void>;
  export function initAudioOnFirstClick(options?: InitAudioOptions): Promise<void>;
  export function setAudioContext(ctx: AudioContext): AudioContext;
  export function getAudioContext(): AudioContext;
  /** Trennt Orbits (Hall, Echo, Filter) und Ausgang – alles Klingende verstummt sofort. */
  export function resetGlobalEffects(): void;
  /** Mischpult von superdough; `output.destinationGain` ist der Master vor `destination` (wird bei resetGlobalEffects neu angelegt). */
  export function getSuperdoughAudioController(): { output: { destinationGain: GainNode | null } };
  export function samples(
    sampleMap: string | Record<string, unknown>,
    baseUrl?: string,
    options?: SamplesOptions,
  ): Promise<void>;
  export function aliasBank(pathOrMap: string | Record<string, unknown>): Promise<void>;
  export function hush(): void;
  export function evaluate(code: string, autoplay?: boolean): Promise<StrudelPattern | undefined>;
  export const silence: StrudelPattern;
  export const DEFAULT_MAX_POLYPHONY: number;
  /** Schreibt alle Exporte der Module in den globalen Strudel-Scope. */
  export function evalScope(...modules: unknown[]): Promise<unknown[]>;
  export const Pattern: { prototype: Record<string, unknown> };
}

declare module '@strudel/web/web.mjs' {
  export * from '@strudel/web';
}

// Zusatzpakete (ohne eigene Typen): werden nur als Modul-Objekt an evalScope gereicht.
declare module '@strudel/xen' {
  export const xen: unknown;
  export const tuning: unknown;
  export function edo(name: string): number[];
}
declare module '@strudel/midi' {
  export const WebMidi: unknown;
  export function enableWebMidi(options?: Record<string, unknown>): Promise<unknown>;
}
declare module '@strudel/motion/motion.mjs' {
  export function enableMotion(): Promise<void>;
}
declare module '@strudel/csound' {
  export const csound: unknown;
  export function loadCSound(code?: string): Promise<void>;
}
