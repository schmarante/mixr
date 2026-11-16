import { describe, expect, it } from 'vitest';
import { blockNameAt, trackBlocksOf, trackHitsBetween } from '../trackHits';

const COMPILED = `setcpm(120/4)

// Drums
$: s("bd*4").gain(0.8)

// Bass
$: note("c2 ~ ~ ~").s("sawtooth")
`;

describe('trackBlocksOf / blockNameAt', () => {
  it('findet Blöcke mit Namenskommentar und ordnet Offsets zu', () => {
    const blocks = trackBlocksOf(COMPILED);
    expect(blocks.map((b) => b.name)).toEqual([null, 'Drums', 'Bass']);
    expect(blockNameAt(blocks, COMPILED.indexOf('bd*4'))).toBe('Drums');
    expect(blockNameAt(blocks, COMPILED.indexOf('c2 ~'))).toBe('Bass');
    expect(blockNameAt(blocks, 0)).toBeNull();
  });

  it('mehrere Leerzeilen und eingerückte Kommentare', () => {
    const code = '// A\n$: s("x")\n\n\n  // B\n$: s("y")';
    expect(trackBlocksOf(code).map((b) => b.name)).toEqual(['A', 'B']);
  });
});

describe('trackHitsBetween', () => {
  /** Pattern-Ersatz: liefert feste Haps mit Onset und Code-Position. */
  const fake = (haps: Array<{ begin: number; at: number }>) => ({
    queryArc: (from: number, to: number) =>
      haps.filter((h) => h.begin < to && h.begin + 0.1 > from).map((h) => ({ whole: { begin: h.begin }, context: { locations: [{ start: h.at }] } })),
  });

  const names = (hits: Array<{ name: string }>) => hits.map((h) => h.name);

  it('meldet nur Onsets im Fenster', () => {
    const blocks = trackBlocksOf(COMPILED);
    const bd = COMPILED.indexOf('bd*4');
    const bass = COMPILED.indexOf('c2 ~');
    const pattern = fake([
      { begin: 0, at: bd },
      { begin: 0.25, at: bd },
      { begin: 0.25, at: bass },
      { begin: 0.5, at: bd },
    ]);
    expect(names(trackHitsBetween(pattern, 0.2, 0.3, blocks))).toEqual(['Drums', 'Bass']);
    // Hap von 0.25 ragt in [0.3, 0.34) hinein, hat dort aber keinen Onset
    expect(trackHitsBetween(pattern, 0.3, 0.34, blocks)).toEqual([]);
    expect(trackHitsBetween(pattern, 0.4, 0.4, blocks)).toEqual([]);
  });

  it('mit dem echten Strudel-REPL: Haps tragen Positionen, die auf die Spur zeigen', async () => {
    const core: any = await import('@strudel/core');
    const mini: any = await import('@strudel/mini');
    const tonal: any = await import('@strudel/tonal');
    const { transpiler } = await import('@strudel/transpiler');
    await core.evalScope(core, mini, tonal);
    mini.miniAllStrings?.();
    const repl = core.repl({
      defaultOutput: async () => {},
      getTime: () => 0,
      transpiler,
      setInterval: () => 0,
      clearInterval: () => {},
    });
    const pattern = await repl.evaluate(COMPILED, false);
    const blocks = trackBlocksOf(COMPILED);
    // Zyklus-Anfang: Kick und Bass gleichzeitig – mit Klang-Merkmalen für die Frequenz-Schätzung
    const start = trackHitsBetween(pattern, 0, 0.01, blocks);
    expect(start.find((h) => h.name === 'Drums')).toMatchObject({ s: 'bd' });
    expect(start.find((h) => h.name === 'Bass')).toMatchObject({ s: 'sawtooth', note: 'c2' });
    // zweite Viertel: nur der Kick
    expect(names(trackHitsBetween(pattern, 0.25, 0.26, blocks))).toEqual(['Drums']);
  });
});
