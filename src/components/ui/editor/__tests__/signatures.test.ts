import { describe, expect, it } from 'vitest';
import { javascript } from '@codemirror/lang-javascript';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { callAt, signatureOf, signatureText, takesArguments } from '../signatures';

/** `|` markiert die Cursorposition. */
function at(textWithCursor: string) {
  const pos = textWithCursor.indexOf('|');
  const doc = textWithCursor.replace('|', '');
  const state = EditorState.create({ doc, extensions: [javascript()] });
  ensureSyntaxTree(state, doc.length, 5000);
  return callAt(state, pos);
}

describe('Signatur-Hilfe', () => {
  it('erkennt Methode und globale Funktion samt Argument-Index', () => {
    expect(at('s("bd").lpf(|)')).toMatchObject({ name: 'lpf', argIndex: 0 });
    expect(at('n("0 2").off(1/8, |)')).toMatchObject({ name: 'off', argIndex: 1 });
    expect(at('note("c3 |e3")')).toMatchObject({ name: 'note', argIndex: 0 });
    expect(at('setcpm(|')).toMatchObject({ name: 'setcpm', argIndex: 0 });
  });

  it('innerster Aufruf gewinnt; außerhalb der Klammern und bei Unbekanntem nichts', () => {
    expect(at('stack(s("bd"), |)')).toMatchObject({ name: 'stack', argIndex: 1 });
    expect(at('stack(s("b|d"))')).toMatchObject({ name: 's', argIndex: 0 });
    expect(at('s("bd").lpf(800)|')).toBeNull();
    expect(at('myOwnThing(|)')).toBeNull();
  });

  it('Signaturen aus den Strudel-Quellen: Parameter mit Typ, Synonyme', () => {
    expect(signatureText('lpf', signatureOf('lpf')!)).toBe('lpf(frequency: number | Pattern)');
    expect(signatureOf('cutoff')?.params[0]?.name).toBe('frequency');
    expect(takesArguments('fast')).toBe(true);
    expect(takesArguments('rev')).toBe(false);
  });
});
