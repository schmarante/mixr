/**
 * Signatur-Hilfe im Code-Editor: Steht der Cursor in den Klammern eines Strudel-Aufrufs
 * (`lpf(|)`, `.off(1/8, |)`), zeigt ein Tooltip über der Zeile, was die Funktion erwartet –
 * der gerade getippte Parameter ist hervorgehoben. Daten: src/data/strudelSignatures.ts
 * (generiert aus den JSDoc-Kommentaren der installierten Strudel-Pakete).
 */
import { syntaxTree } from '@codemirror/language';
import { StateField, type EditorState } from '@codemirror/state';
import { showTooltip, type Tooltip } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { STRUDEL_SIGNATURES, type StrudelParam, type StrudelSignature } from '../../../data/strudelSignatures';

export function signatureOf(name: string): StrudelSignature | null {
  return Object.hasOwn(STRUDEL_SIGNATURES, name) ? STRUDEL_SIGNATURES[name]! : null;
}

/** Hat die Funktion Parameter? (Dann setzt die Vervollständigung gleich die Klammern.) */
export function takesArguments(name: string): boolean {
  return (signatureOf(name)?.params.length ?? 0) > 0;
}

function paramText(p: StrudelParam): string {
  return `${p.name}${p.optional ? '?' : ''}${p.type ? `: ${p.type}` : ''}`;
}

/** „lpf(frequency: number | Pattern)“ */
export function signatureText(name: string, sig: StrudelSignature): string {
  return `${name}(${sig.params.map(paramText).join(', ')})`;
}

/** Info-Panel zu einem Vorschlag: Signatur + Kurzbeschreibung. */
export function signatureInfo(name: string): HTMLElement | null {
  const sig = signatureOf(name);
  if (!sig) return null;
  const dom = document.createElement('div');
  dom.className = 'cm-strudel-signature';
  const head = dom.appendChild(document.createElement('div'));
  head.className = 'cm-strudel-signature-head';
  head.textContent = signatureText(name, sig);
  if (sig.doc) {
    const doc = dom.appendChild(document.createElement('div'));
    doc.className = 'cm-strudel-signature-doc';
    doc.textContent = sig.doc;
  }
  return dom;
}

export interface CallInfo {
  name: string;
  /** Index des Arguments, in dem der Cursor steht (0-basiert). */
  argIndex: number;
  /** Beginn der Argumentliste (Position der öffnenden Klammer). */
  from: number;
}

/** Name des aufgerufenen Ausdrucks: `lpf(` → lpf, `.lpf(` → lpf, `x.y.lpf(` → lpf. */
function calleeName(state: EditorState, call: SyntaxNode): string | null {
  const callee = call.firstChild;
  if (!callee) return null;
  const target = callee.name === 'MemberExpression' ? callee.lastChild : callee;
  if (!target || (target.name !== 'VariableName' && target.name !== 'PropertyName')) return null;
  return state.sliceDoc(target.from, target.to);
}

/** Innerster Strudel-Aufruf, in dessen Klammern `pos` liegt (oder null). */
export function callAt(state: EditorState, pos: number): CallInfo | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  for (; node; node = node.parent) {
    if (node.name !== 'ArgList') continue;
    // nur zwischen „(“ und „)“ (eine fehlende schließende Klammer zählt als offen)
    const closed = state.sliceDoc(node.to - 1, node.to) === ')' && node.to - node.from > 1;
    if (pos <= node.from || (closed && pos >= node.to)) continue;
    const call = node.parent;
    if (!call || call.name !== 'CallExpression') continue;
    const name = calleeName(state, call);
    if (!name || !signatureOf(name)) return null;
    let argIndex = 0;
    for (let child = node.firstChild; child && child.from < pos; child = child.nextSibling) {
      if (child.name === ',') argIndex++;
    }
    return { name, argIndex, from: node.from };
  }
  return null;
}

/** Aktiver Parameter: bei Rest-Parametern (`...patterns`) bleibt der letzte aktiv. */
function activeParam(sig: StrudelSignature, argIndex: number): number {
  const last = sig.params.length - 1;
  if (last < 0) return -1;
  if (argIndex <= last) return argIndex;
  return sig.params[last]!.name.startsWith('...') ? last : -1;
}

function renderSignature(name: string, sig: StrudelSignature, argIndex: number): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'cm-strudel-signature';
  const head = dom.appendChild(document.createElement('div'));
  head.className = 'cm-strudel-signature-head';
  const active = activeParam(sig, argIndex);
  head.append(`${name}(`);
  sig.params.forEach((p, i) => {
    if (i > 0) head.append(', ');
    const span = head.appendChild(document.createElement('span'));
    span.textContent = paramText(p);
    if (i === active) span.className = 'cm-strudel-signature-active';
  });
  head.append(')');
  const doc = active >= 0 ? sig.params[active]!.doc : undefined;
  const text = doc ? `${sig.params[active]!.name.replace(/^\.\.\./, '')}: ${doc}` : sig.doc;
  if (text) {
    const info = dom.appendChild(document.createElement('div'));
    info.className = 'cm-strudel-signature-doc';
    info.textContent = text;
  }
  return dom;
}

interface HintState {
  key: string;
  tooltip: Tooltip | null;
}

function computeHint(state: EditorState): HintState {
  const sel = state.selection.main;
  const call = sel.empty ? callAt(state, sel.head) : null;
  if (!call) return { key: '', tooltip: null };
  const sig = signatureOf(call.name)!;
  return {
    key: `${call.name}@${call.from}:${call.argIndex}`,
    tooltip: {
      pos: call.from,
      above: true,
      strictSide: true,
      arrow: false,
      create: () => ({ dom: renderSignature(call.name, sig, call.argIndex) }),
    },
  };
}

/** Tooltip-Feld: bei Cursor-/Textänderung neu bestimmt, neu gezeichnet nur bei anderem Aufruf/Argument. */
export const signatureHint = StateField.define<HintState>({
  create: computeHint,
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value;
    const next = computeHint(tr.state);
    return next.key === value.key && !tr.docChanged ? value : next;
  },
  provide: (f) => showTooltip.from(f, (v) => v.tooltip),
});
