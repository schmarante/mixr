/**
 * Dekorationen des Strudel-Editors – verändern nie den Text:
 *  - Mini-Notation (Strings in "…" und `…`) dezent abgesetzt,
 *  - Highlighter: gerade klingende Mini-Atome (aktiv + sanftes Ausblenden),
 *  - Fehlerstelle (Syntaxfehler / Mini-Notation).
 */
import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { CodeRange } from '../../../store/agentBus';

/* ------------------------------ Mini-Notation ------------------------------ */

const miniMark = Decoration.mark({ class: 'cm-mini' });

function miniDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === 'TemplateString' || (node.name === 'String' && view.state.doc.sliceString(node.from, node.from + 1) === '"')) {
          if (node.to > node.from) builder.add(node.from, node.to, miniMark);
          return false;
        }
        return undefined;
      },
    });
  }
  return builder.finish();
}

/** Strudel liest Strings in doppelten Anführungszeichen und Backticks als Mini-Notation. */
export const miniStrings: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = miniDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = miniDecorations(u.view);
    }
  },
  { decorations: (p) => p.decorations },
);

/* ------------------------------- Highlighter ------------------------------- */

export interface HighlightRanges {
  active: readonly CodeRange[];
  fading: readonly CodeRange[];
}

export const setHighlights = StateEffect.define<HighlightRanges>();

const activeMark = Decoration.mark({ class: 'cm-strudel-active' });
const fadeMark = Decoration.mark({ class: 'cm-strudel-fade' });

function buildRanges(len: number, list: Array<{ r: CodeRange; mark: Decoration }>): DecorationSet {
  const sorted = list
    .filter(({ r }) => r.start >= 0 && r.end <= len && r.end > r.start)
    .sort((a, b) => a.r.start - b.r.start || a.r.end - b.r.end);
  return Decoration.set(sorted.map(({ r, mark }) => mark.range(r.start, r.end)), true);
}

export const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setHighlights)) {
        return buildRanges(tr.state.doc.length, [
          ...e.value.fading.map((r) => ({ r, mark: fadeMark })),
          ...e.value.active.map((r) => ({ r, mark: activeMark })),
        ]);
      }
    }
    // Text geändert → Positionen gehören nicht mehr zum gespielten Code.
    return tr.docChanged ? Decoration.none : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/* -------------------------------- Fehler -------------------------------- */

export const setErrorRange = StateEffect.define<CodeRange | null>();
const errorMark = Decoration.mark({ class: 'cm-strudel-error' });

export const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setErrorRange)) {
        const r = e.value;
        if (!r) return Decoration.none;
        const len = tr.state.doc.length;
        const start = Math.max(0, Math.min(r.start, len));
        let end = Math.max(start, Math.min(r.end, len));
        if (end === start && start < len) end = start + 1;
        return end > start ? Decoration.set([errorMark.range(start, end)]) : Decoration.none;
      }
    }
    return tr.docChanged ? deco.map(tr.changes) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/* ------------------------------ Text-Abgleich ------------------------------ */

/** Minimale Änderung von `a` nach `b` (gemeinsamer Anfang/Ende) – Cursor bleibt so sinnvoll stehen. */
export function minimalChange(a: string, b: string): { from: number; to: number; insert: string } | null {
  if (a === b) return null;
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  return { from: start, to: endA, insert: b.slice(start, endB) };
}
