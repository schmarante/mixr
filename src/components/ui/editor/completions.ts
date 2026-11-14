/**
 * Autovervollständigung für Strudel-Code: Funktionen (nur die, die in strudelmixr laufen –
 * Klasse 'engine' aus src/data/strudelFunctions.ts, inkl. Aliase), Klang-Controls
 * (src/blocks/controls.ts, mit Gruppe) und Klangnamen (eingebaute + eigene Sample-Slots).
 *
 * Die Kandidatenlisten sind reine Daten (getestet), die CodeMirror-Quelle wertet nur den
 * Kontext aus (Methode nach „.“, Klangname in s("…"), Bank in .bank("…")).
 */
import { pickedCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { DRUM_INSTRUMENTS } from '../../../blocks/catalog';
import { CONTROL_GROUPS, CONTROLS, type ControlGroup } from '../../../blocks/controls';
import { STRUDEL_FUNCTIONS } from '../../../data/strudelFunctions';
import { t, tDynamic, type Language } from '../../../i18n';
import { signatureInfo, signatureOf, takesArguments } from './signatures';

/** Mitgelieferte Drum-Kits (public/samples/drums/strudel.json). */
export const KIT_NAMES = ['modern', 'analog', 'emu808'] as const;

/** Eingebaute Klänge: Synths von superdough + selbst gehostete Samples (public/samples/*). */
export const BUILTIN_SOUNDS: readonly string[] = [
  // Synths
  'sine', 'triangle', 'square', 'sawtooth', 'supersaw', 'pulse', 'sbd', 'bytebeat',
  'white', 'pink', 'brown', 'crackle',
  'z_sine', 'z_triangle', 'z_square', 'z_sawtooth', 'z_tan', 'z_noise',
  // Drums (ohne Bank = modern)
  ...DRUM_INSTRUMENTS.map((i) => i.value),
  // Samples
  'piano', 'tabla', 'elec', 'perc', 'glitch', 'bass', 'ambi', 'vinyl', 'misc',
];

export type CompletionKind = 'function' | 'control' | 'sound' | 'sample' | 'kit';

export interface CompletionEntry {
  label: string;
  kind: CompletionKind;
  /** Hauptname, falls `label` ein Alias ist. */
  aliasOf?: string;
  group?: ControlGroup;
}

let cached: { functions: CompletionEntry[]; controls: CompletionEntry[] } | null = null;

/**
 * Funktionen + Controls (jeder Name einmal; Controls haben Vorrang, weil sie eine Gruppe tragen).
 * Controls sind in Strudel zugleich Pattern-Methoden und globale Funktionen.
 */
export function codeEntries(): { functions: CompletionEntry[]; controls: CompletionEntry[] } {
  if (cached) return cached;
  const controls: CompletionEntry[] = [];
  const seen = new Set<string>();
  for (const c of CONTROLS) {
    for (const name of [c.name, ...c.aliases]) {
      if (seen.has(name)) continue;
      seen.add(name);
      controls.push(name === c.name ? { label: name, kind: 'control', group: c.group } : { label: name, kind: 'control', group: c.group, aliasOf: c.name });
    }
  }
  const functions: CompletionEntry[] = [];
  for (const fn of STRUDEL_FUNCTIONS) {
    if (fn.status !== 'engine') continue;
    const newer = new Set(fn.newerNames ?? []);
    for (const name of [fn.name, ...fn.aliases]) {
      if (seen.has(name) || newer.has(name)) continue;
      seen.add(name);
      functions.push(name === fn.name ? { label: name, kind: 'function' } : { label: name, kind: 'function', aliasOf: fn.name });
    }
  }
  cached = { functions, controls };
  return cached;
}

/** Klangnamen: eigene Slots zuerst, dann eingebaute. */
export function soundEntries(ownSamples: readonly string[]): CompletionEntry[] {
  const own = [...new Set(ownSamples)].map((label): CompletionEntry => ({ label, kind: 'sample' }));
  const taken = new Set(own.map((e) => e.label));
  return [...own, ...BUILTIN_SOUNDS.filter((s) => !taken.has(s)).map((label): CompletionEntry => ({ label, kind: 'sound' }))];
}

export function kitEntries(): CompletionEntry[] {
  return KIT_NAMES.map((label) => ({ label, kind: 'kit' }));
}

/** Kurzinfo (Gruppe / Alias) in der aktuellen Sprache. */
export function entryDetail(e: CompletionEntry): string {
  const group = e.group ? (tDynamic(`blocks.controlGroups.${e.group}`) ?? e.group) : null;
  const base =
    e.kind === 'control' ? (group ?? '') :
    e.kind === 'function' ? t('ui.editor.completion.function') :
    e.kind === 'sample' ? t('ui.editor.completion.ownSample') :
    e.kind === 'kit' ? t('ui.editor.completion.kit') :
    t('ui.editor.completion.sound');
  return e.aliasOf ? t('ui.editor.completion.alias', { name: e.aliasOf, detail: base }) : base;
}

const BOOST: ReadonlySet<string> = new Set([
  's', 'sound', 'note', 'n', 'chord', 'stack', 'cat', 'seq', 'arrange', 'setcpm', 'bank', 'scale', 'voicing',
  'lpf', 'hpf', 'room', 'delay', 'gain', 'pan', 'fast', 'slow', 'struct', 'jux', 'rev', 'off', 'every', 'sometimes',
]);

/**
 * Übernimmt einen Funktionsnamen samt Klammern, der Cursor landet dazwischen – dort zeigt
 * der Signatur-Hinweis, was die Funktion erwartet. Steht schon eine „(“ dahinter, nur der Name.
 */
function applyCall(view: EditorView, completion: Completion, from: number, to: number): void {
  const hasParen = view.state.sliceDoc(to, to + 1) === '(';
  const insert = hasParen ? completion.label : `${completion.label}()`;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + completion.label.length + 1 },
    annotations: pickedCompletion.of(completion),
    userEvent: 'input.complete',
  });
}

/** Name, unter dem die Signatur steht (Alias → Hauptname, falls nur der dokumentiert ist). */
function signatureName(e: CompletionEntry): string | null {
  if (signatureOf(e.label)) return e.label;
  return e.aliasOf && signatureOf(e.aliasOf) ? e.aliasOf : null;
}

/** @param call true im Code-Editor: Funktionen mit Parametern bekommen Klammern und Signatur-Info. */
function toCompletion(e: CompletionEntry, call = false): Completion {
  const type = e.kind === 'function' ? 'function' : e.kind === 'control' ? 'property' : e.kind === 'kit' ? 'enum' : 'constant';
  const boost = BOOST.has(e.label) ? 2 : e.aliasOf ? -1 : e.group && CONTROL_GROUPS.indexOf(e.group) > 10 ? -2 : 0;
  const completion: Completion = { label: e.label, type, detail: entryDetail(e), boost };
  const sigName = call && (e.kind === 'function' || e.kind === 'control') ? signatureName(e) : null;
  if (sigName) {
    completion.info = () => signatureInfo(sigName);
    if (takesArguments(sigName)) completion.apply = applyCall;
  }
  return completion;
}

const byLanguage = new Map<string, Completion[]>();
function codeCompletions(lang: Language): Completion[] {
  let list = byLanguage.get(`code:${lang}`);
  if (!list) {
    const { functions, controls } = codeEntries();
    list = [...controls, ...functions].map((e) => toCompletion(e, true));
    byLanguage.set(`code:${lang}`, list);
  }
  return list;
}

function controlCompletions(lang: Language): Completion[] {
  let list = byLanguage.get(`controls:${lang}`);
  if (!list) {
    list = codeEntries().controls.map((e) => toCompletion(e));
    byLanguage.set(`controls:${lang}`, list);
  }
  return list;
}

/** Strudel-Code (JS): Funktionen/Controls, in s("…") Klangnamen, in .bank("…") Kits. */
export function strudelCompletionSource(getLanguage: () => Language, getOwnSamples: () => readonly string[]): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
    if (node.name === 'LineComment' || node.name === 'BlockComment') return null;
    if (node.name === 'String' || node.name === 'TemplateString') {
      const before = ctx.state.doc.sliceString(Math.max(0, node.from - 24), node.from);
      const word = ctx.matchBefore(/[\w]*/);
      if (!word || (word.from === word.to && !ctx.explicit)) return null;
      const entries = /\.bank\s*\(\s*$/.test(before)
        ? kitEntries()
        : /(?:^|[^\w$])(?:s|sound)\s*\(\s*$|\.(?:s|sound)\s*\(\s*$/.test(before)
          ? soundEntries(getOwnSamples())
          : null;
      if (!entries) return null;
      return { from: word.from, options: entries.map((e) => toCompletion(e)), validFor: /^\w*$/ };
    }
    const word = ctx.matchBefore(/[\w$]+/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    if (/^\d/.test(word.text)) return null;
    return { from: word.from, options: codeCompletions(getLanguage()), validFor: /^[\w$]*$/ };
  };
}

/** Nur Control-Namen (Baustein „Beliebiger Parameter“, Feld „Name“). */
export function controlNameCompletionSource(getLanguage: () => Language): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const word = ctx.matchBefore(/[\w$]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    return { from: word.from, options: controlCompletions(getLanguage()), validFor: /^[\w$]*$/ };
  };
}
