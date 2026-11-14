#!/usr/bin/env node
/**
 * Erzeugt src/data/strudelFunctions.ts: alle Funktionen der strudel.cc-API-Referenz
 * mit Aliasen und der Angabe, ob sie in strudelmixr laufen.
 *
 *   node scripts/import-strudel-functions.mjs [functions.txt] [--scope scope.json]
 *
 * functions.txt (Standard: research/functions.txt) – eine Funktion je Zeile:
 *   „name alias1, alias2“ (Quelle: API-Referenz auf strudel.cc).
 *
 * scope.json (Standard: research/strudel-scope.json, falls vorhanden) – gemessener Scope:
 *   { "strudelmixr": { "globals": [...], "methods": [...] },
 *     "strudelcc":   { "globals": [...], "methods": [...] } }
 * Messen: Seite öffnen (strudelmixr: Code mit tune/midi/accX/csound abspielen, damit die
 * Zusatzpakete geladen sind; strudel.cc: nach dem Laden), dann in der Browser-Konsole
 * SCOPE_SNIPPET (unten) ausführen und das Ergebnis unter dem jeweiligen Schlüssel speichern.
 * Ohne scope.json bleibt die Klassifikation der bisherigen Datei erhalten (neue Namen → Fehler).
 *
 * Klassifikation:
 *   unsupported – bewusst nicht eingebunden (UNSUPPORTED)
 *   editor      – Widget/Darstellung des strudel.cc-Editors, bei uns No-op (EDITOR)
 *   internal    – interne Hilfsfunktion ohne Nutzen im Code (INTERNAL)
 *   engine      – existiert nach dem Engine-Start (global oder als Pattern-Methode) bzw. ENGINE
 *   newer       – fehlt bei uns, existiert aber auf strudel.cc (neuere Strudel-Version)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = `${ROOT}src/data/strudelFunctions.ts`;

/** In der Browser-Konsole ausführen (siehe oben). */
export const SCOPE_SNIPPET = `(() => {
  const f = document.createElement('iframe'); document.body.append(f); const base = f.contentWindow;
  const native = (v) => typeof v === 'function' && /\\{\\s*\\[native code\\]\\s*\\}\\s*$/.test(Function.prototype.toString.call(v));
  const globals = Object.getOwnPropertyNames(globalThis).filter((k) => {
    let v; try { v = globalThis[k]; } catch { return false; }
    if (v === undefined || native(v)) return false;
    return !(k in base) || typeof v === 'function';
  });
  f.remove();
  const P = globalThis.Pattern?.prototype ?? {};
  const methods = Object.getOwnPropertyNames(P).filter((k) => { try { return typeof P[k] === 'function'; } catch { return false; } });
  return JSON.stringify({ globals, methods });
})()`;

/** Bewusst nicht eingebunden. */
const UNSUPPORTED = new Set([
  // @strudel/osc: braucht einen lokalen OSC-Server (Node-Brücke)
  'osc',
  'oschost',
  'oscport',
]);

/** Editor-Widgets/Darstellung von strudel.cc – bei uns No-op-Shims bzw. ohne Wirkung (installReplShims). */
const EDITOR = new Set([
  'pianoroll',
  'scope',
  'fscope',
  'spectrum',
  'spiral',
  'pitchwheel',
  'wordfall',
  'markcss',
  'slider',
  'color',
  'hsl',
  'hsla',
]);

/** Interne Hilfsfunktionen (Implementierungsdetails, Worklet-/DSP-Interna, Geräte-Helfer). */
const INTERNAL = new Set([
  // Worklet-/DSP-Interna (supradough, Phase-Vocoder, Faltungshall)
  'applyGradualLowpass',
  'applyHannWindow',
  'computeMagnitudes',
  'findPeaks',
  'shiftPeaks',
  'handleOutputBuffersToRetrieve',
  'prepareInputBuffersToSend',
  'readInputs',
  'reallocateChannelsIfNeeded',
  'shiftInputBuffers',
  'shiftOutputBuffers',
  'writeOutputs',
  'generateReverb',
  'generateGraph',
  // Geräte-/MIDI-Helfer
  'getDevice',
  'getMidiDeviceNamesString',
  'createCC',
  // Hilfsfunktionen von superdough/Worklets (nicht im Scope)
  'pickAndRename',
  'chyx',
  // Debug-Ausgaben
  'drawLine',
  'firstCycleValues',
  'showFirstCycle',
  // Pattern-Interna
  'withHapSpan',
  'withHapTime',
  'withQuerySpan',
  'withQueryTime',
  'withHap',
  'withHaps',
  'withContext',
  'setContext',
  'stripContext',
  'withLoc',
  'splitQueries',
  'defragmentHaps',
  'sortHapsByPart',
  'filterHaps',
  'discreteOnly',
  'onTriggerTime',
  'removeUndefineds',
  'initDough',
  // Dokumentations-Artefakte (OSC-Server-Ereignisse), im Code nirgends verfügbar
  'open',
  'close',
]);

/** Laufen, ohne als Name im Scope aufzutauchen (Syntax des Transpilers). */
const ENGINE = new Set([
  // Kabelsalat-Ausdrücke: .K(…) schreibt der Transpiler zu .worklet(…) um
  'K',
]);

function parseFunctions(text) {
  const entries = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const space = line.indexOf(' ');
    const name = space < 0 ? line : line.slice(0, space);
    const aliases =
      space < 0
        ? []
        : line
            .slice(space + 1)
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean);
    entries.push({ name, aliases });
  }
  return entries;
}

function scopeSet(scope) {
  return scope ? new Set([...(scope.globals ?? []), ...(scope.methods ?? [])]) : null;
}

async function previousStatuses() {
  if (!existsSync(OUT)) return new Map();
  const mod = await import(pathToFileURL(OUT).href);
  return new Map(mod.STRUDEL_FUNCTIONS.map((fn) => [fn.name, fn]));
}

async function main() {
  const args = process.argv.slice(2);
  const scopeFlag = args.indexOf('--scope');
  const scopePath = scopeFlag >= 0 ? args.splice(scopeFlag, 2)[1] : `${ROOT}research/strudel-scope.json`;
  const listPath = args[0] ?? `${ROOT}research/functions.txt`;

  const entries = parseFunctions(readFileSync(listPath, 'utf8'));
  const scope = existsSync(scopePath) ? JSON.parse(readFileSync(scopePath, 'utf8')) : null;
  const mixr = scopeSet(scope?.strudelmixr);
  const cc = scopeSet(scope?.strudelcc);
  const previous = mixr ? new Map() : await previousStatuses();

  const unclassified = [];
  const result = entries.map(({ name, aliases }) => {
    const all = [name, ...aliases];
    let status;
    let newerNames = [];
    if (UNSUPPORTED.has(name)) status = 'unsupported';
    else if (EDITOR.has(name)) status = 'editor';
    else if (INTERNAL.has(name)) status = 'internal';
    else if (ENGINE.has(name)) status = 'engine';
    else if (mixr) {
      if (all.some((n) => mixr.has(n))) {
        status = 'engine';
        newerNames = cc ? all.filter((n) => !mixr.has(n) && cc.has(n)) : [];
      } else if (cc && all.some((n) => cc.has(n))) status = 'newer';
    } else {
      const prev = previous.get(name);
      status = prev?.status;
      newerNames = prev?.newerNames ?? [];
    }
    if (!status) unclassified.push(name);
    return { name, aliases, status, newerNames };
  });

  if (unclassified.length) {
    console.error(
      `Nicht klassifizierbar (weder bei uns noch auf strudel.cc gefunden) – in EDITOR/INTERNAL/UNSUPPORTED eintragen:\n  ${unclassified.join(', ')}`,
    );
    process.exit(1);
  }

  const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const lines = result.map(({ name, aliases, status, newerNames }) => {
    const extra = newerNames.length ? `, newerNames: [${newerNames.map(q).join(', ')}]` : '';
    return `  { name: ${q(name)}, aliases: [${aliases.map(q).join(', ')}], status: ${q(status)}${extra} },`;
  });
  const counts = {};
  for (const { status } of result) counts[status] = (counts[status] ?? 0) + 1;

  const out = `/**
 * Alle Funktionen der strudel.cc-API-Referenz (mit Aliasen) und ob sie in strudelmixr laufen.
 *
 * GENERIERT von scripts/import-strudel-functions.mjs – nicht von Hand bearbeiten.
 * Reine Daten ohne Imports.
 *
 * ${Object.entries(counts)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')} (gesamt ${result.length})
 */

/**
 * - engine: läuft (global oder als Pattern-Methode nach dem Engine-Start, Zusatzpakete eingeschlossen)
 * - editor: Widget/Darstellung des strudel.cc-Editors – bei uns ohne Wirkung (No-op)
 * - internal: interne Hilfsfunktion, im Code ohne Nutzen
 * - newer: gibt es auf strudel.cc, aber noch nicht in der veröffentlichten npm-Version
 * - unsupported: bewusst nicht eingebunden (z. B. OSC, braucht einen lokalen Server)
 */
export type StrudelFunctionStatus = 'engine' | 'editor' | 'internal' | 'newer' | 'unsupported';

export interface StrudelFunction {
  name: string;
  aliases: readonly string[];
  status: StrudelFunctionStatus;
  /** Schreibweisen (Name/Aliase), die erst eine neuere Strudel-Version kennt – die Funktion selbst läuft. */
  newerNames?: readonly string[];
}

export const STRUDEL_FUNCTIONS: readonly StrudelFunction[] = [
${lines.join('\n')}
];
`;
  writeFileSync(OUT, out);
  console.log(`${OUT}: ${result.length} Funktionen – ${JSON.stringify(counts)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
