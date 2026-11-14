import { describe, expect, it } from 'vitest';
import { compressSequence, drumRow } from '../compiler/sequence';
import { evaluateStrudel } from './strudelHarness';

const row = (p: string) => [...p].map((c) => c === 'x');

describe('Drum-Komprimierung (Lesbarkeit)', () => {
  it.each([
    ['x---x---x---x---', 'bd*4'],
    ['x-x-x-x-x-x-x-x-', 'bd*8'],
    ['xxxxxxxxxxxxxxxx', 'bd*16'],
    ['----x-------x---', '~ bd ~ bd'],
    ['--x---x---x---x-', '[~ bd]*4'],
    ['-x-x-x-x-x-x-x-x', '[~ bd]*8'],
    ['x---------------', 'bd'],
    ['x------x--x-----', 'bd ~ ~ ~ ~ ~ ~ bd ~ ~ bd ~ ~ ~ ~ ~'],
    ['x--x--x-x--x--x-', '[bd ~ ~ bd ~ ~ bd ~]*2'],
  ])('%s → %s', (pattern, expected) => {
    expect(drumRow('bd', row(pattern), { stretch: true })).toBe(expected);
  });

  it('ohne Ausdünnen wird nur exakt gefaltet', () => {
    expect(drumRow('bd', row('x---x---x---x---'), { stretch: false })).toBe('[bd ~ ~ ~]*4');
    expect(drumRow('bd', row('x-x-x-x-x-x-x-x-'), { stretch: false })).toBe('[bd ~]*8');
    expect(drumRow('bd', row('x------x--x-----'), { stretch: false })).toBe('bd ~ ~ ~ ~ ~ ~ bd ~ ~ bd ~ ~ ~ ~ ~');
  });

  it('Noten-Tokens', () => {
    expect(compressSequence(['0', '~', '2', '~', '0', '~', '2', '~'], { stretch: false })).toBe('[0 ~ 2 ~]*2');
    expect(compressSequence(['0', '[0,2]'], { stretch: false })).toBe('0 [0,2]');
  });
});

/* ------------------------------------------------------------------ */
/* Äquivalenz in echter Strudel-Auswertung                             */
/* ------------------------------------------------------------------ */

/** Deterministischer Pseudo-Zufall (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function* grids(): Generator<boolean[]> {
  // strukturierte Fälle (gleichmäßig, periodisch, ausdünnbar) …
  for (const steps of [16, 12, 8, 32]) {
    for (const every of [1, 2, 3, 4, 8]) {
      for (const offset of [0, 1, 2]) {
        yield Array.from({ length: steps }, (_, i) => i % every === offset % every);
      }
    }
  }
  // … plus Zufall mit unterschiedlicher Dichte
  const r = rng(42);
  for (let k = 0; k < 120; k++) {
    const steps = [16, 16, 16, 8, 12, 32][k % 6]!;
    const density = [0.1, 0.25, 0.5, 0.8][k % 4]!;
    yield Array.from({ length: steps }, () => r() < density);
  }
}

const uncompressed = (hits: boolean[]) => hits.map((h) => (h ? 'bd' : '~')).join(' ');

describe('Drum-Komprimierung ist musikalisch äquivalent (echte Strudel-Events)', () => {
  it('Ausdünnen: identische Onsets & Werte über mehrere Zyklen', async () => {
    let compressedSome = 0;
    for (const hits of grids()) {
      if (!hits.some(Boolean)) continue;
      const compact = drumRow('bd', hits, { stretch: true });
      if (compact !== uncompressed(hits)) compressedSome++;
      const a = (await evaluateStrudel(`$: s("${compact}")`)).query(0, 3);
      const b = (await evaluateStrudel(`$: s("${uncompressed(hits)}")`)).query(0, 3);
      expect(a.map((h) => [h.begin, h.value]), `${uncompressed(hits)} vs ${compact}`).toEqual(b.map((h) => [h.begin, h.value]));
    }
    expect(compressedSome).toBeGreaterThan(20);
  });

  it('exakte Faltung: identische Onsets, Dauern & Werte', async () => {
    for (const hits of grids()) {
      if (!hits.some(Boolean)) continue;
      const compact = drumRow('bd', hits, { stretch: false });
      const a = (await evaluateStrudel(`$: s("${compact}")`)).query(0, 3);
      const b = (await evaluateStrudel(`$: s("${uncompressed(hits)}")`)).query(0, 3);
      expect(a, `${uncompressed(hits)} vs ${compact}`).toEqual(b);
    }
  });

  it('gestapelte Zeilen bleiben unabhängig (Komma-Stack)', async () => {
    const rows = { bd: row('x---x---x---x---'), sd: row('----x-------x---'), hh: row('--x---x---x---x-') };
    const compact = Object.entries(rows).map(([n, h]) => drumRow(n, h, { stretch: true })).join(', ');
    const plain = Object.entries(rows).map(([n, h]) => h.map((x) => (x ? n : '~')).join(' ')).join(', ');
    expect(compact).toBe('bd*4, ~ sd ~ sd, [~ hh]*4');
    const a = (await evaluateStrudel(`$: s("${compact}")`)).query(0, 2);
    const b = (await evaluateStrudel(`$: s("${plain}")`)).query(0, 2);
    expect(a.map((h) => [h.begin, h.value])).toEqual(b.map((h) => [h.begin, h.value]));
  });
});
