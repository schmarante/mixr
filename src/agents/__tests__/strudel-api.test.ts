import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { core, evaluateStrudel } from './strudelHarness';

/**
 * Sichert ab, dass jeder Funktionsname, den der Compiler erzeugt, in der
 * installierten Strudel-Version existiert (und dokumentiert die Abweichungen).
 */

const PATTERN_METHODS = [
  // Quellen / Tonalität
  'bank', 'scale', 's', 'n', 'note', 'voicing', 'struct', 'speed', 'transpose',
  // Modifier
  'fast', 'slow', 'rev', 'firstOf', 'degradeBy', 'ply', 'jux', 'sometimesBy',
  // Effekte
  'lpf', 'lpq', 'hpf', 'hpq', 'room', 'roomsize', 'delay', 'delaysync', 'delayfeedback',
  'crush', 'distort', 'pan', 'attack', 'decay', 'sustain', 'release', 'orbit', 'gain', 'range',
];
const GLOBALS = ['s', 'n', 'note', 'chord', 'rev', 'sine', 'saw', 'tri', 'square', 'perlin', 'setcpm'];

describe('Strudel-API der installierten Version', () => {
  it('alle verwendeten Pattern-Methoden existieren', async () => {
    await evaluateStrudel('$: s("bd")'); // registriert Scope inkl. tonal & setcpm
    const missing = PATTERN_METHODS.filter((m) => typeof core.Pattern.prototype[m] !== 'function');
    expect(missing).toEqual([]);
  });

  it('alle verwendeten globalen Funktionen/Signale existieren', async () => {
    await evaluateStrudel('$: s("bd")');
    const g = globalThis as Record<string, unknown>;
    expect(GLOBALS.filter((name) => g[name] === undefined)).toEqual([]);
  });

  it('dokumentierte Abweichungen: kein .up() in 1.2.x (→ transpose/speed)', () => {
    expect(core.Pattern.prototype.up).toBeUndefined();
  });

  it('Synth-Klänge des Katalogs sind in superdough registriert (inkl. supersaw)', () => {
    const require = createRequire(import.meta.url);
    const synth = readFileSync(require.resolve('superdough/synth.mjs'), 'utf8');
    for (const name of ['sawtooth', 'square', 'triangle', 'sine', 'supersaw']) {
      expect(synth).toContain(`'${name}'`);
    }
  });

  it('der Test-Harness meldet Evaluationsfehler wirklich', async () => {
    await expect(evaluateStrudel('$: s("bd").gibtEsNicht()')).rejects.toThrow();
  });
});
