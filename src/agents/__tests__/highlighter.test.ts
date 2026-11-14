/**
 * Highlighter & Editor-Override im AudioAgent: Positionen aus dem Transpiler
 * (`hap.context.locations`) müssen exakt auf den angezeigten Code zeigen.
 * Geprüft mit echtem Strudel (core + mini + tonal + Transpiler wie in der REPL).
 */
import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../../data/templates';
import { activeRangesAt, errorRangeOf, prepareCode, selectEvalSource } from '../AudioAgent';
import { compile } from '../CompilerAgent';

interface Pattern {
  queryArc(a: number, b: number, controls?: Record<string, unknown>): Array<{ value: Record<string, unknown>; whole?: { begin: { valueOf(): number } } }>;
}

async function makeRepl() {
  const core: any = await import('@strudel/core');
  const mini: any = await import('@strudel/mini');
  const tonal: any = await import('@strudel/tonal');
  const { transpiler } = await import('@strudel/transpiler');
  await core.evalScope(core, mini, tonal);
  mini.miniAllStrings?.();
  const evals: Array<{ code: string; meta: { miniLocations?: Array<[number, number]> } }> = [];
  const errors: unknown[] = [];
  const repl = core.repl({
    defaultOutput: async () => {},
    getTime: () => 0,
    transpiler,
    setInterval: () => 0,
    clearInterval: () => {},
    onEvalError: (e: unknown) => errors.push(e),
    afterEval: (info: { code: string; meta: { miniLocations?: Array<[number, number]> } }) => evals.push(info),
  });
  return { repl, evals, errors };
}

/** Wie der AudioAgent: Schlüssel der Mini-Positionen aus den Transpiler-Metadaten. */
function keysOf(meta: { miniLocations?: Array<[number, number]> }): Set<string> {
  return new Set((meta.miniLocations ?? []).map(([a, b]) => `${a}:${b}`));
}

/** Liegt die Position innerhalb eines Strings in doppelten Anführungszeichen? */
function insideDoubleQuotes(code: string, pos: number): boolean {
  const line = code.slice(code.lastIndexOf('\n', pos - 1) + 1, pos);
  return (line.match(/"/g) ?? []).length % 2 === 1;
}

describe('Editor-Override', () => {
  it('Editor-Text hat Vorrang vor dem kompilierten Code', () => {
    expect(selectEvalSource('$: s("bd")', null)).toBe('$: s("bd")');
    expect(selectEvalSource('$: s("bd")', '$: s("bd*8")')).toBe('$: s("bd*8")');
    expect(selectEvalSource('$: s("bd")', '')).toBe('');
  });
});

describe('Highlighter-Positionen', () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s: Positionen zeigen auf Mini-Atome im angezeigten Code', async (_id, tpl) => {
    const code = compile(tpl.ast, { bpm: 120 }).code;
    // prepareCode darf nichts verschieben – sonst passen die Offsets nicht zum Editor
    expect(prepareCode(code)).toBe(code);
    const { repl, evals } = await makeRepl();
    const pattern = (await repl.evaluate(code, false)) as Pattern;
    expect(pattern).toBeTruthy();
    const last = evals.at(-1)!;
    expect(last.code).toBe(code);
    const keys = keysOf(last.meta);
    expect(keys.size).toBeGreaterThan(0);

    let seen = 0;
    for (const cycle of [0, 0.125, 0.3, 0.5, 0.75, 1.0625, 2.5]) {
      for (const r of activeRangesAt(pattern, cycle, keys)) {
        seen++;
        expect(r.end).toBeGreaterThan(r.start);
        const text = code.slice(r.start, r.end);
        expect(text).toMatch(/^[\w#.:~^-]+$/);
        expect(insideDoubleQuotes(code, r.start)).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('Kick auf Zyklus 0 markiert genau „bd“ in s("bd*4 …") – auch im bearbeiteten Editor-Text', async () => {
    const { repl, evals } = await makeRepl();
    const text = 'setcpm(30)\n\n// Beat\n$: s("bd*8, ~ sd").bank("modern")\n';
    const pattern = (await repl.evaluate(text, false)) as Pattern;
    const ranges = activeRangesAt(pattern, 0, keysOf(evals.at(-1)!.meta));
    const bd = text.indexOf('"bd*8') + 1;
    expect(ranges).toContainEqual({ start: bd, end: bd + 2 });
    expect(ranges.every((r) => text.slice(r.start, r.end) !== 'sd')).toBe(true);
    // Ein Sechzehntel später klingt die zweite Kick (bd*8), sd erst auf der Hälfte
    const half = activeRangesAt(pattern, 0.5, keysOf(evals.at(-1)!.meta)).map((r) => text.slice(r.start, r.end));
    expect(half).toEqual(expect.arrayContaining(['bd', 'sd']));
  });

  it('Positionen außerhalb des Quelltexts (zur Laufzeit geparste Strings) werden verworfen', async () => {
    const { repl, evals } = await makeRepl();
    const text = "$: s('hh*4').stack(s(\"cp\"))";
    const pattern = (await repl.evaluate(text, false)) as Pattern;
    const keys = keysOf(evals.at(-1)!.meta);
    const all = activeRangesAt(pattern, 0);
    const filtered = activeRangesAt(pattern, 0, keys);
    expect(filtered.every((r) => text.slice(r.start, r.end) === 'cp')).toBe(true);
    expect(all.length).toBeGreaterThanOrEqual(filtered.length);
  });

  it('Fehlerstelle: Syntaxfehler (pos) und Mini-Notation (Zeile)', async () => {
    const { repl, errors } = await makeRepl();
    const broken = '$: s("bd*4").lpf(\n$: s("hh")';
    await repl.evaluate(broken, false);
    const syntax = errorRangeOf(errors.at(-1), broken);
    expect(syntax).not.toBeNull();
    expect(syntax!.start).toBeGreaterThan(broken.indexOf('lpf('));

    const miniBroken = 'setcpm(30)\n$: s("bd [sd")';
    await repl.evaluate(miniBroken, false);
    const mini = errorRangeOf(errors.at(-1), miniBroken);
    expect(mini).toEqual({ start: miniBroken.indexOf('$:'), end: miniBroken.length });
    expect(errorRangeOf(new Error('foo is not defined'), 'x')).toBeNull();
  });
});
