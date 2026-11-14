import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_CATALOG, DRUM_BANKS, OCTAVES, ROOT_NOTES, SCALES, emptyDrumGrid, emptyNoteGrid } from '../../blocks/catalog';
import type { BlockType, ParamValues, SelectParamDef, TrackParams } from '../../types/ast';
import { languageStore } from '../../i18n';
import { compile } from '../CompilerAgent';
import { buildTestAst, SETTINGS, type TestTrack } from './astBuilder';
import { evaluateStrudel, transpile, type StrudelHap } from './strudelHarness';

/* ------------------------------------------------------------------ */
/* Helfer                                                              */
/* ------------------------------------------------------------------ */

// Diagnosen sind Text in der aktuellen Sprache; die Tests prüfen Deutsch (Englisch: eigener Block unten).
beforeEach(() => languageStore.set('de'));

function run(tracks: TestTrack[], bpm = SETTINGS.bpm) {
  return compile(buildTestAst(tracks), { bpm });
}

/** Kompiliert, prüft Transpiler + Evaluation und liefert Events der Zyklen [from, to). */
async function events(tracks: TestTrack[], from = 0, to = 1): Promise<StrudelHap[]> {
  const { code } = run(tracks);
  expect(code).not.toBe('');
  expect(() => transpile(code)).not.toThrow();
  const { query } = await evaluateStrudel(code);
  return query(from, to);
}

/** Zeile `$: …` der n-ten ausgegebenen Spur. */
function line(code: string, n = 0): string {
  return code.split('\n').filter((l) => l.startsWith('$: '))[n]!;
}

const kick = (): TestTrack['blocks'][number] => ({
  type: 'drums',
  params: { grid: grid({ bd: 'x---x---x---x---' }), bank: 'default' },
});

function grid(rows: Record<string, string>) {
  const g = emptyDrumGrid();
  for (const [name, pattern] of Object.entries(rows)) g.rows[name] = [...pattern].map((c) => c === 'x');
  return g;
}

function notes(line: Array<number | number[] | null>) {
  const g = emptyNoteGrid(line.length);
  g.cells = line.map((c) => (c === null ? [] : Array.isArray(c) ? c : [c]));
  return g;
}

/* ------------------------------------------------------------------ */
/* Grundgerüst                                                         */
/* ------------------------------------------------------------------ */

describe('Grundgerüst', () => {
  it('leeres Projekt → leerer Code ohne Diagnosen', () => {
    expect(compile({ nodes: [], edges: [] }, SETTINGS)).toEqual({ code: '', diagnostics: [] });
  });

  it('Spur ohne Klangquelle → übersprungen + Diagnose an der Spur', () => {
    const r = run([{ blocks: [] }, { blocks: [{ type: 'room' }] }]);
    expect(r.code).toBe('');
    expect(r.diagnostics.map((d) => d.nodeId)).toEqual(['t1', 't2']);
    expect(r.diagnostics[0]!.message).toMatch(/keine Klangquelle/);
  });

  it('erzeugt das dokumentierte Format und das richtige Tempo', async () => {
    const r = run([
      { track: { name: 'Drums 1' }, blocks: [{ type: 'drums' }, { type: 'room' }] },
      { track: { name: 'Melodie 2' }, blocks: [{ type: 'melody' }, { type: 'lpf' }] },
    ]);
    expect(r.diagnostics).toEqual([]);
    expect(r.code).toBe(
      [
        'setcpm(120/4)',
        '',
        '// Drums 1',
        '$: s("bd*4, ~ sd ~ sd, [~ hh]*4").bank("modern").room(0.4).roomsize(3).gain(0.8)',
        '',
        '// Melodie 2',
        '$: n("0 ~ 2 ~ 4 ~ 2 ~ 0 ~ 4 5 4 ~ 2 ~").scale("C3:minor").s("sawtooth").lpf(1200).gain(0.8)',
      ].join('\n'),
    );
    const { cps, query } = await evaluateStrudel(r.code);
    expect(cps).toBeCloseTo(0.5); // 120 BPM, 4 Schläge pro Zyklus
    const haps = query(0, 1);
    expect(haps.filter((h) => h.value.s === 'bd').map((h) => h.begin)).toEqual([0, 0.25, 0.5, 0.75]);
    expect(haps.filter((h) => h.value.s === 'sd').map((h) => h.begin)).toEqual([0.25, 0.75]);
    expect(haps.find((h) => h.value.s === 'sawtooth')!.value).toMatchObject({ note: 'C3', cutoff: 1200, gain: 0.8 });
  });

  it('ungültiges Tempo → Fallback 120 + Diagnose', () => {
    const r = compile(buildTestAst([{ blocks: [kick()] }]), { bpm: Number.NaN });
    expect(r.code.startsWith('setcpm(120/4)')).toBe(true);
    expect(r.diagnostics).toHaveLength(1);
  });

  it('Lautstärke als .gain() am Ende, sauber gerundet', async () => {
    const r = run([{ track: { volume: 0.1 + 0.2 }, blocks: [kick(), { type: 'degrade', params: { amount: 0.1 + 0.2 } }] }]);
    expect(line(r.code)).toBe('$: s("bd*4").degradeBy(0.3).gain(0.3)');
    expect(r.code).not.toMatch(/0000000/);
  });
});

/* ------------------------------------------------------------------ */
/* Mute / Solo / Bypass                                                */
/* ------------------------------------------------------------------ */

describe('Mute, Solo, Bypass', () => {
  const two = (a: Partial<TrackParams>, b: Partial<TrackParams>): TestTrack[] => [
    { track: { name: 'A', ...a }, blocks: [kick()] },
    { track: { name: 'B', ...b }, blocks: [{ type: 'sample', params: { pattern: 'east' } }] },
  ];

  it('gemutete Spuren fehlen', () => {
    const r = run(two({ muted: true }, {}));
    expect(r.code).not.toContain('// A');
    expect(r.code).toContain('// B');
  });

  it('alles gemutet → leerer Code', () => {
    expect(run(two({ muted: true }, { muted: true })).code).toBe('');
  });

  it('Solo → nur Solo-Spuren', async () => {
    const r = run(two({}, { solo: true }));
    expect(r.code).not.toContain('// A');
    expect(r.code).toContain('// B');
    const haps = await events(two({}, { solo: true }));
    expect(haps.every((h) => h.value.s === 'east')).toBe(true);
  });

  it('Solo + Mute auf derselben Spur → stumm', () => {
    expect(run(two({ solo: true, muted: true }, {})).code).toBe('');
  });

  it('überbrückte Blöcke werden übersprungen', () => {
    const r = run([{ blocks: [kick(), { type: 'fast', bypassed: true }, { type: 'room', bypassed: true }, { type: 'rev' }] }]);
    expect(line(r.code)).toBe('$: s("bd*4").rev().gain(0.8)');
  });

  it('überbrückte Klangquelle → Spur stumm + Diagnose', () => {
    const r = run([{ blocks: [{ ...kick(), bypassed: true }, { type: 'room' }] }]);
    expect(r.code).toBe('');
    expect(r.diagnostics[0]).toMatchObject({ nodeId: 't1' });
    expect(r.diagnostics[0]!.message).toMatch(/überbrückt/);
  });
});

/* ------------------------------------------------------------------ */
/* Jeder Blocktyp                                                      */
/* ------------------------------------------------------------------ */

describe('jeder Blocktyp mit Default-Parametern', () => {
  const types = Object.keys(BLOCK_CATALOG) as BlockType[];
  it.each(types)('%s kompiliert ohne Diagnose und erzeugt Events', async (type) => {
    const isSource = BLOCK_CATALOG[type].kind === 'source';
    const blocks = isSource ? [{ type }] : [{ type: 'melody' as const }, { type }];
    const r = run([{ blocks }]);
    expect(r.diagnostics).toEqual([]);
    const haps = await events([{ blocks }], 0, 4);
    expect(haps.length).toBeGreaterThan(0);
  });
});

describe('Klangquellen', () => {
  it('Drums: bank "default" → kein .bank()', () => {
    expect(line(run([{ blocks: [kick()] }]).code)).toBe('$: s("bd*4").gain(0.8)');
  });

  it.each(DRUM_BANKS.filter((b) => b.value !== 'default'))('Drums: Bank $value', async ({ value }) => {
    const haps = await events([{ blocks: [{ type: 'drums', params: { bank: value } }] }]);
    expect(haps.every((h) => h.value.bank === value)).toBe(true);
  });

  it('Drums: leeres Raster → Block + Spur übersprungen, eine Diagnose am Block', () => {
    const r = run([{ blocks: [{ type: 'drums', params: { grid: emptyDrumGrid() } }] }]);
    expect(r.code).toBe('');
    expect(r.diagnostics).toEqual([{ nodeId: 't1-b1', message: expect.stringMatching(/Raster ist leer/) }]);
  });

  it('Drums: ungültige Instrumentnamen werden ignoriert, kein Code-Bruch', async () => {
    const g = grid({ bd: 'x---------------' });
    g.rows['x") , evil("'] = Array<boolean>(16).fill(true);
    const r = run([{ blocks: [{ type: 'drums', params: { grid: g, bank: 'default' } }] }]);
    expect(line(r.code)).toBe('$: s("bd").gain(0.8)');
  });

  it('Melodie: Skalenstufen, Pausen und Akkorde', async () => {
    const blocks: TestTrack['blocks'] = [
      { type: 'melody', params: { grid: notes([0, null, [0, 2, 4], null]), root: 'D', scale: 'major', octave: '4', sound: 'square' } },
    ];
    expect(line(run([{ blocks }]).code)).toBe('$: n("0 ~ [0,2,4] ~").scale("D4:major").s("square").gain(0.8)');
    const haps = await events([{ blocks }]);
    expect(haps.map((h) => [h.begin, h.value.note])).toEqual([
      [0, 'D4'],
      [0.5, 'A4'],
      [0.5, 'D4'],
      [0.5, 'F#4'],
    ]);
  });

  it('Melodie: alle Grundtöne × Tonleitern liefern echte Noten', async () => {
    for (const root of ROOT_NOTES) {
      for (const scale of SCALES) {
        const haps = await events([
          { blocks: [{ type: 'melody', params: { grid: notes([0, 1, 2, 7]), root: root.value, scale: scale.value } }] },
        ]);
        expect(haps).toHaveLength(4);
        for (const h of haps) expect(String(h.value.note), `${root.value} ${scale.value}`).toMatch(/^[A-G][#b]*\d$/);
      }
    }
  });

  it.each(OCTAVES)('Melodie: Lage $value', async ({ value }) => {
    const haps = await events([{ blocks: [{ type: 'melody', params: { grid: notes([0]), root: 'C', octave: value } }] }]);
    expect(haps[0]!.value.note).toBe(`C${value}`);
  });

  it('Melodie: leeres Raster → Diagnose', () => {
    const r = run([{ blocks: [{ type: 'melody', params: { grid: emptyNoteGrid() } }] }]);
    expect(r.code).toBe('');
    expect(r.diagnostics[0]!.nodeId).toBe('t1-b1');
  });

  it.each((BLOCK_CATALOG.chords.params[0] as SelectParamDef).options)('Akkorde: Folge $value', async ({ value }) => {
    const haps = await events([{ blocks: [{ type: 'chords', params: { progression: value } }] }], 0, 4);
    const cycles = new Set(haps.map((h) => Math.floor(h.begin)));
    expect(cycles).toEqual(new Set([0, 1, 2, 3]));
    for (const h of haps) expect(String(h.value.note)).toMatch(/^[A-G][#b]*\d$/);
  });

  it.each([
    ['hold', '', [0]],
    ['quarter', '.struct("x*4")', [0, 0.25, 0.5, 0.75]],
    ['offbeat', '.struct("[~ x]*4")', [0.125, 0.375, 0.625, 0.875]],
  ] as const)('Akkorde: Anschlag %s', async (rhythm, struct, onsets) => {
    const blocks: TestTrack['blocks'] = [{ type: 'chords', params: { rhythm } }];
    expect(line(run([{ blocks }]).code)).toBe(`$: chord("<Am F C G>").voicing()${struct}.s("piano").gain(0.8)`);
    const haps = await events([{ blocks }]);
    expect([...new Set(haps.map((h) => h.begin))]).toEqual(onsets);
  });

  it('Akkorde: eigenes Feld überschreibt die Auswahl, ohne Klammern → <…>', async () => {
    const blocks: TestTrack['blocks'] = [{ type: 'chords', params: { custom: 'Dm7 G7' } }];
    expect(line(run([{ blocks }]).code)).toContain('chord("<Dm7 G7>")');
    const c0 = (await events([{ blocks }], 0, 1)).map((h) => h.value.note);
    const c1 = (await events([{ blocks }], 1, 2)).map((h) => h.value.note);
    expect(c0).not.toEqual(c1);
    expect(line(run([{ blocks: [{ type: 'chords', params: { custom: '<C [F G]>' } }] }]).code)).toContain('chord("<C [F G]>")');
  });

  it('Sample: Muster und Tonhöhe', async () => {
    const blocks: TestTrack['blocks'] = [{ type: 'sample', params: { pattern: 'casio ~ casio:1 ~', speed: 1.5 } }];
    expect(line(run([{ blocks }]).code)).toBe('$: s("casio ~ casio:1 ~").speed(1.5).gain(0.8)');
    const haps = await events([{ blocks }]);
    expect(haps.map((h) => [h.begin, h.value.s, h.value.n ?? 0, h.value.speed])).toEqual([
      [0, 'casio', 0, 1.5],
      [0.5, 'casio', 1, 1.5],
    ]);
  });

  it('Code: wird roh übernommen, Semikolon am Ende entfernt', async () => {
    const blocks: TestTrack['blocks'] = [{ type: 'code', params: { code: 'note("c3 e3").s("triangle");' } }, { type: 'fast' }];
    expect(line(run([{ blocks }]).code)).toBe('$: note("c3 e3").s("triangle").fast(2).gain(0.8)');
    expect(await events([{ blocks }])).toHaveLength(4);
  });

  it('Code: Kommentar in der letzten Zeile verschluckt die Kette nicht', async () => {
    const blocks: TestTrack['blocks'] = [{ type: 'code', params: { code: 's("bd*2") // mein Beat' } }, { type: 'pan', params: { position: 0.2 } }];
    const haps = await events([{ blocks }]);
    expect(haps).toHaveLength(2);
    expect(haps[0]!.value).toMatchObject({ pan: 0.2, gain: 0.8 });
  });

  it('Code: leeres Feld → Diagnose statt kaputtem Code', () => {
    const r = run([{ blocks: [{ type: 'code', params: { code: '   ' } }] }]);
    expect(r.code).toBe('');
    expect(r.diagnostics[0]!.nodeId).toBe('t1-b1');
  });

  it('zweite Klangquelle in einer Spur → ignoriert + Diagnose', () => {
    const r = run([{ blocks: [kick(), { type: 'sample' }] }]);
    expect(line(r.code)).toBe('$: s("bd*4").gain(0.8)');
    expect(r.diagnostics[0]!.nodeId).toBe('t1-b2');
  });
});

/* ------------------------------------------------------------------ */
/* Modifier                                                            */
/* ------------------------------------------------------------------ */

describe('Modifier', () => {
  const src = kick();
  const count = async (blocks: TestTrack['blocks'], from = 0, to = 1) => (await events([{ blocks: [src, ...blocks] }], from, to)).length;

  it('fast / slow', async () => {
    expect(line(run([{ blocks: [src, { type: 'fast', params: { factor: 2 } }] }]).code)).toContain('.fast(2)');
    expect(await count([{ type: 'fast', params: { factor: 2 } }])).toBe(8);
    expect(line(run([{ blocks: [src, { type: 'slow', params: { factor: 2 } }] }]).code)).toContain('.slow(2)');
    expect(await count([{ type: 'slow', params: { factor: 2 } }])).toBe(2);
  });

  it('rev', async () => {
    const haps = await events([{ blocks: [{ type: 'sample', params: { pattern: 'a b c ~' } }, { type: 'rev' }] }]);
    expect(haps.map((h) => [h.begin, h.value.s])).toEqual([
      [0.25, 'c'],
      [0.5, 'b'],
      [0.75, 'a'],
    ]);
  });

  it.each([
    ['rev', 'x => x.rev()'],
    ['fast', 'x => x.fast(2)'],
    ['up', 'x => x.speed(2)'],
    ['degrade', 'x => x.degradeBy(0.5)'],
  ])('firstOf mit Aktion %s', async (action, fn) => {
    const blocks: TestTrack['blocks'] = [{ type: 'firstOf', params: { every: 4, action } }];
    expect(line(run([{ blocks: [src, ...blocks] }]).code)).toBe(`$: s("bd*4").firstOf(4, ${fn}).gain(0.8)`);
    await events([{ blocks: [src, ...blocks] }], 0, 4);
  });

  it('firstOf verändert nur jeden n-ten Takt', async () => {
    const blocks: TestTrack['blocks'] = [{ type: 'firstOf', params: { every: 4, action: 'fast' } }];
    expect(await count(blocks, 0, 1)).toBe(8);
    expect(await count(blocks, 1, 2)).toBe(4);
    expect(await count(blocks, 4, 5)).toBe(8);
  });

  it('„Oktave höher“ passt sich der Quelle an', async () => {
    const mel = await events([{ blocks: [{ type: 'melody', params: { grid: notes([0]) } }, { type: 'firstOf', params: { every: 2, action: 'up' } }] }], 0, 2);
    expect(mel.map((h) => h.value.note)).toEqual(['C4', 'C3']);
    const chords = await events([{ blocks: [{ type: 'chords' }, { type: 'sometimes', params: { chance: 1, action: 'up' } }] }]);
    const plain = await events([{ blocks: [{ type: 'chords' }] }]);
    expect(chords.map((h) => h.value.note)).not.toEqual(plain.map((h) => h.value.note));
    const sample = run([{ blocks: [{ type: 'sample', params: { speed: 0.5 } }, { type: 'firstOf', params: { action: 'up' } }] }]);
    expect(line(sample.code)).toContain('.firstOf(4, x => x.speed(1))');
    const code = run([{ blocks: [{ type: 'code' }, { type: 'firstOf', params: { action: 'up' } }] }]);
    expect(line(code.code)).toContain('x => x.transpose(12)');
  });

  it('degradeBy lässt Noten weg', async () => {
    const all = await count([], 0, 16);
    const some = await count([{ type: 'degrade', params: { amount: 0.5 } }], 0, 16);
    expect(some).toBeLessThan(all);
    expect(some).toBeGreaterThan(0);
  });

  it('ply', async () => {
    expect(await count([{ type: 'ply', params: { times: 3 } }])).toBe(12);
  });

  it('jux(rev) → links & rechts', async () => {
    const haps = await events([{ blocks: [src, { type: 'jux' }] }]);
    expect(line(run([{ blocks: [src, { type: 'jux' }] }]).code)).toContain('.jux(rev)');
    expect(new Set(haps.map((h) => h.value.pan))).toEqual(new Set([0, 1]));
  });

  it.each([
    ['ply', 'x => x.ply(2)'],
    ['up', 'x => x.speed(2)'],
    ['crush', 'x => x.crush(4)'],
  ])('sometimesBy mit Aktion %s', async (action, fn) => {
    const blocks: TestTrack['blocks'] = [src, { type: 'sometimes', params: { chance: 1, action } }];
    expect(line(run([{ blocks }]).code)).toBe(`$: s("bd*4").sometimesBy(1, ${fn}).gain(0.8)`);
    const haps = await events([{ blocks }]);
    if (action === 'ply') expect(haps).toHaveLength(8);
    if (action === 'up') expect(haps.every((h) => h.value.speed === 2)).toBe(true);
    if (action === 'crush') expect(haps.every((h) => h.value.crush === 4)).toBe(true);
  });

  it('code-mod: führender Punkt wird ergänzt', async () => {
    const withDot = run([{ blocks: [src, { type: 'code-mod', params: { code: '.euclid(3,8)' } }] }]);
    const without = run([{ blocks: [src, { type: 'code-mod', params: { code: 'euclid(3,8)' } }] }]);
    // freier Code kann Dauern hörbar machen → Raster wird nur exakt gefaltet, nicht ausgedünnt
    expect(line(withDot.code)).toBe('$: s("[bd ~ ~ ~]*4").euclid(3,8).gain(0.8)');
    expect(without.code).toBe(withDot.code);
    await events([{ blocks: [src, { type: 'code-mod', params: { code: 'ply(2)' } }] }]);
  });

  it('code-mod: Default (.off mit note) ist gültiger Code', async () => {
    const haps = await events([{ blocks: [{ type: 'melody', params: { grid: notes([0]) } }, { type: 'code-mod' }] }]);
    expect(haps).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/* Effekte                                                             */
/* ------------------------------------------------------------------ */

describe('Effekte', () => {
  const fx = async (block: TestTrack['blocks'][number]) => {
    const blocks = [kick(), block];
    const haps = await events([{ blocks }]);
    return { code: line(run([{ blocks }]).code), value: haps[0]!.value, haps };
  };

  it('lpf / lpq (lpq nur wenn ≠ 1)', async () => {
    expect((await fx({ type: 'lpf', params: { cutoff: 800 } })).code).toBe('$: s("bd*4").lpf(800).gain(0.8)');
    const r = await fx({ type: 'lpf', params: { cutoff: 800.4, resonance: 8 } });
    expect(r.code).toContain('.lpf(800).lpq(8)');
    expect(r.value).toMatchObject({ cutoff: 800, resonance: 8 });
  });

  it('hpf / hpq', async () => {
    const r = await fx({ type: 'hpf', params: { cutoff: 300, resonance: 5 } });
    expect(r.code).toContain('.hpf(300).hpq(5)');
    expect(r.value).toMatchObject({ hcutoff: 300, hresonance: 5 });
  });

  it.each(['sine', 'saw', 'tri', 'square', 'perlin'])('Filter-Fahrt mit Verlauf %s', async (shape) => {
    const r = await fx({ type: 'sweep', params: { min: 300, max: 3000, cycles: 4, shape } });
    expect(r.code).toContain(`.lpf(${shape}.range(300, 3000).slow(4))`);
    for (const h of r.haps) {
      expect(h.value.cutoff).toBeGreaterThanOrEqual(300);
      expect(h.value.cutoff).toBeLessThanOrEqual(3000);
    }
  });

  it('Filter-Fahrt über 1 Takt ohne .slow()', async () => {
    expect((await fx({ type: 'sweep', params: { cycles: 1 } })).code).toContain('.lpf(sine.range(300, 3000))');
  });

  it('room / roomsize', async () => {
    const r = await fx({ type: 'room', params: { amount: 0.5, size: 6 } });
    expect(r.code).toContain('.room(0.5).roomsize(6)');
    expect(r.value).toMatchObject({ room: 0.5, roomsize: 6 });
  });

  it('delay / delaysync (in Takten) / delayfeedback', async () => {
    const r = await fx({ type: 'delay', params: { amount: 0.5, time: '0.25', feedback: 0.6 } });
    expect(r.code).toContain('.delay(0.5).delaysync(0.25).delayfeedback(0.6)');
    expect(r.value).toMatchObject({ delay: 0.5, delaysync: 0.25, delayfeedback: 0.6 });
  });

  it('crush', async () => {
    expect((await fx({ type: 'crush', params: { bits: 4 } })).value).toMatchObject({ crush: 4 });
  });

  it('distort (Regler 0…1 → 0…4)', async () => {
    const r = await fx({ type: 'distort', params: { amount: 0.3 } });
    expect(r.code).toContain('.distort(1.2)');
    expect(r.value).toMatchObject({ distort: 1.2 });
  });

  it('pan', async () => {
    expect((await fx({ type: 'pan', params: { position: 0.25 } })).value).toMatchObject({ pan: 0.25 });
  });

  it('adsr', async () => {
    const r = await fx({ type: 'adsr', params: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 1 } });
    expect(r.code).toContain('.attack(0.1).decay(0.2).sustain(0.5).release(1)');
    expect(r.value).toMatchObject({ attack: 0.1, decay: 0.2, sustain: 0.5, release: 1 });
  });

  it('code-fx: roh, Punkt wird ergänzt', async () => {
    const r = await fx({ type: 'code-fx', params: { code: 'vowel("<a e>")' } });
    expect(r.code).toContain('.vowel("<a e>")');
    expect(r.value).toMatchObject({ vowel: 'a' });
  });

  it('Hall/Echo in mehreren Spuren → eigene Orbits', async () => {
    const tracks: TestTrack[] = [
      { blocks: [kick(), { type: 'room', params: { size: 2 } }] },
      { blocks: [{ type: 'melody' }, { type: 'room', params: { size: 8 } }] },
      { blocks: [{ type: 'sample' }] },
    ];
    const r = run(tracks);
    expect(line(r.code, 0)).toContain('.orbit(2).gain(0.8)');
    expect(line(r.code, 1)).toContain('.orbit(3).gain(0.8)');
    expect(line(r.code, 2)).not.toContain('.orbit(');
    const orbits = new Set((await events(tracks)).map((h) => h.value.orbit));
    expect(orbits).toEqual(new Set([2, 3, undefined]));
  });

  it('nur eine Spur mit Hall → kein .orbit()', () => {
    expect(run([{ blocks: [kick(), { type: 'room' }] }, { blocks: [{ type: 'melody' }, { type: 'delay' }] }]).code).not.toContain('orbit');
  });
});

/* ------------------------------------------------------------------ */
/* Validierung & Escaping                                              */
/* ------------------------------------------------------------------ */

describe('Validierung & Escaping', () => {
  it.each<[BlockType, ParamValues]>([
    ['lpf', { cutoff: Number.NaN }],
    ['lpf', { cutoff: '' }],
    ['fast', { factor: 'schnell' }],
    ['delay', { time: '7; alert(1)' }],
    ['firstOf', { action: 'explode' }],
    ['sweep', { shape: 'noise()' }],
  ])('%s mit %o → Block übersprungen + Diagnose', async (type, params) => {
    const r = run([{ blocks: [kick(), { type, params }, { type: 'pan', params: { position: 0.3 } }] }]);
    expect(line(r.code)).toBe('$: s("bd*4").pan(0.3).gain(0.8)');
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]!.nodeId).toBe('t1-b2');
    expect(r.diagnostics[0]!.message).toMatch(/übersprungen/);
  });

  it('Zahlen außerhalb des Bereichs werden begrenzt, Strings mit Zahlen akzeptiert', () => {
    const r = run([{ blocks: [kick(), { type: 'lpf', params: { cutoff: 999999 } }, { type: 'room', params: { amount: '0.25' } }] }]);
    expect(line(r.code)).toContain('.lpf(12000)');
    expect(line(r.code)).toContain('.room(0.25)');
  });

  it('fehlende Parameter → Katalog-Default', () => {
    const ast = buildTestAst([{ blocks: [kick(), { type: 'lpf' }] }]);
    const lpf = ast.nodes.find((n) => n.id === 't1-b2')!;
    lpf.params = {};
    expect(line(compile(ast, SETTINGS).code)).toContain('.lpf(1200)');
  });

  it('Anführungszeichen in Mini-Notation können keinen Code einschleusen', async () => {
    const evil = 'bd"; globalThis.pwned = 1; "';
    const tracks: TestTrack[] = [{ blocks: [{ type: 'sample', params: { pattern: evil } }] }];
    const r = run(tracks);
    expect(line(r.code)).toBe('$: s("bd; globalThis.pwned = 1;").gain(0.8)');
    expect(() => transpile(r.code)).not.toThrow();
    await evaluateStrudel(r.code).catch(() => undefined); // darf an Mini-Syntax scheitern, aber nichts ausführen
    expect((globalThis as Record<string, unknown>).pwned).toBeUndefined();
  });

  it('Backslash, Backtick und Zeilenumbruch werden neutralisiert', () => {
    const r = run([{ blocks: [{ type: 'sample', params: { pattern: 'bd\\" `x`\nsd' } }] }]);
    expect(line(r.code)).toBe('$: s("bd x sd").gain(0.8)');
  });

  it('eigene Akkorde mit Quote-Injection', async () => {
    const r = run([{ blocks: [{ type: 'chords', params: { custom: 'Am") ; hush(); ("' } }] }]);
    expect(() => transpile(r.code)).not.toThrow();
    expect(r.code).not.toMatch(/"\)\s*;/);
  });

  it('unausgeglichene Klammern → Diagnose statt kaputtem Code', () => {
    const r = run([{ blocks: [{ type: 'sample', params: { pattern: '[bd sd' } }] }]);
    expect(r.code).toBe('');
    expect(r.diagnostics[0]).toMatchObject({ nodeId: 't1-b1', message: expect.stringMatching(/Klammern/) });
  });

  it('Spurname mit Zeilenumbruch bleibt ein einzeiliger Kommentar', async () => {
    const r = run([{ track: { name: 'Böse\n$: s("hh*16")' }, blocks: [kick()] }]);
    expect(r.code.split('\n').filter((l) => l.startsWith('$:'))).toHaveLength(1);
    const haps = await events([{ track: { name: 'Böse\n$: s("hh*16")' }, blocks: [kick()] }]);
    expect(haps).toHaveLength(4);
  });

  it('kaputter Raster-Wert → Diagnose', () => {
    const r = run([{ blocks: [{ type: 'drums', params: { grid: 'kaputt' } }] }]);
    expect(r.code).toBe('');
    expect(r.diagnostics[0]!.nodeId).toBe('t1-b1');
  });

  it('unbekannte Sound-Namen mit Sonderzeichen werden abgelehnt, einfache akzeptiert', () => {
    expect(run([{ blocks: [{ type: 'melody', params: { sound: 'gm_epiano1' } }] }]).code).toContain('.s("gm_epiano1")');
    const bad = run([{ blocks: [{ type: 'melody', params: { sound: 'x").y("' } }] }]);
    expect(bad.code).toBe('');
    expect(bad.diagnostics).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* Sprache der Diagnosen                                               */
/* ------------------------------------------------------------------ */

describe('Diagnosen auf Englisch', () => {
  beforeEach(() => languageStore.set('en'));

  it('Spur ohne Klangquelle / überbrückte Quelle', () => {
    const r = run([{ track: { name: 'Lead' }, blocks: [] }, { track: { name: 'Pad' }, blocks: [{ ...kick(), bypassed: true }] }]);
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      '“Lead” doesn\'t have a sound source yet – add Drums or a Melody, for example.',
      '“Pad” is silent because its sound source is switched off.',
    ]);
  });

  it('ungültiger Parameter nennt Block und Parameter auf Englisch', () => {
    const r = run([{ blocks: [kick(), { type: 'lpf', params: { cutoff: 'hell' } }] }]);
    expect(r.diagnostics[0]!.message).toBe('Filter (muffled): “Brightness” isn\'t a valid number. This block will be skipped.');
  });

  it('leeres Raster und leere Mini-Notation', () => {
    expect(run([{ blocks: [{ type: 'drums', params: { grid: emptyDrumGrid() } }] }]).diagnostics[0]!.message).toBe(
      'Drums: The grid is empty – click a few boxes. This block will be skipped.',
    );
    expect(run([{ blocks: [{ type: 'sample', params: { pattern: '[bd' } }] }]).diagnostics[0]!.message).toBe(
      'Sample: “Pattern”: The brackets don\'t match up. This block will be skipped.',
    );
  });

  it('der erzeugte Code ist unabhängig von der Sprache', () => {
    const tracks: TestTrack[] = [{ track: { name: 'Drums 1' }, blocks: [kick(), { type: 'room' }] }];
    const en = run(tracks).code;
    languageStore.set('de');
    expect(run(tracks).code).toBe(en);
  });
});

describe('Setup-Code (prelude)', () => {
  it('steht nach setcpm vor den Spuren, eigene Funktionen aus register() sind in den Spuren nutzbar', async () => {
    const prelude = "register('loud', (pat) => pat.gain(0.5))\nconst kick = 'bd'";
    const ast = buildTestAst([{ blocks: [{ type: 'code', params: { code: 's(kick).loud()' } }] }]);
    const r = compile(ast, { bpm: 120, prelude });
    expect(r.code.split('\n\n').slice(0, 2)).toEqual(['setcpm(120/4)', `// Setup\n${prelude}`]);
    const { query } = await evaluateStrudel(r.code);
    expect(query(0, 1).map((h) => h.value.s)).toEqual(['bd']);
  });

  it('leerer Setup-Code erzeugt nichts', () => {
    const ast = buildTestAst([{ blocks: [{ type: 'code', params: { code: 's("bd")' } }] }]);
    expect(compile(ast, { bpm: 120, prelude: '  ' }).code).not.toContain('// Setup');
  });
});

describe('Melodie: Haltetöne und mehrere Takte', () => {
  const melody = (grid: Record<string, unknown>) =>
    compile(buildTestAst([{ blocks: [{ type: 'melody', params: { grid: grid as never, root: 'C', scale: 'major', octave: '4', sound: 'triangle' } }] }]), {
      bpm: 120,
    });

  it('ohne Haltetöne bleibt die kompakte Schreibweise unverändert', () => {
    const r = melody({ steps: 4, cells: [[0], [], [2], []] });
    expect(line(r.code)).toContain('n("0 ~ 2 ~")');
  });

  it('Haltetöne → @-Gewichte, Noten klingen in Strudel exakt so lang', async () => {
    const r = melody({ steps: 8, cells: [[0], [], [], [], [2, 4], [], [], []], lengths: [[4], [], [], [], [2, 2], [], [], []] });
    expect(line(r.code)).toContain('n("0@4 [2,4]@2 ~@2")');
    const { query } = await evaluateStrudel(r.code);
    const haps = query(0, 1).map((h) => [h.begin, h.end, h.value.note]);
    expect(haps).toEqual([
      [0, 0.5, 'C4'],
      [0.5, 0.75, 'E4'],
      [0.5, 0.75, 'G4'],
    ]);
  });

  it('überlappende Noten → zweite Stimme per Komma', async () => {
    const r = melody({ steps: 4, cells: [[0], [2], [], []], lengths: [[4], [1], [], []] });
    expect(line(r.code)).toContain('n("0@4, ~ 2 ~@2")');
    const { query } = await evaluateStrudel(r.code);
    expect(query(0, 1).map((h) => [h.begin, h.end, h.value.note])).toEqual([
      [0, 1, 'C4'],
      [0.25, 0.5, 'E4'],
    ]);
  });

  it('mehrere Takte → .slow(bars), Noten verteilen sich über alle Takte, auch über Taktgrenzen gehalten', async () => {
    const cells = Array.from({ length: 8 }, () => [] as number[]);
    const lengths = Array.from({ length: 8 }, () => [] as number[]);
    cells[0] = [0];
    lengths[0] = [2];
    cells[3] = [4];
    lengths[3] = [3]; // von Takt 1 (Step 4/4) bis in Takt 2 hinein
    const r = melody({ steps: 4, bars: 2, cells, lengths });
    expect(line(r.code)).toContain('n("0@2 ~ 4@3 ~@2").slow(2)');
    const { query } = await evaluateStrudel(r.code);
    expect(query(0, 2).map((h) => [h.begin, h.end, h.value.note])).toEqual([
      [0, 0.5, 'C4'],
      [0.75, 1.5, 'G4'],
    ]);
  });

  it('Dauern über das Rasterende hinaus werden gekürzt, kaputte Werte ignoriert', () => {
    const r = melody({ steps: 4, cells: [[], [], [], [0]], lengths: [[], [], [], [9]] });
    expect(line(r.code)).toContain('n("~ ~ ~ 0")');
    const broken = melody({ steps: 4, cells: [[0], [], [], []], lengths: 'x' });
    expect(line(broken.code)).toContain('n("0 ~ ~ ~")');
  });
});

describe('Orbits aus dem Code haben Vorrang', () => {
  it('Spuren mit .o()/.orbit() bekommen keinen automatischen Orbit, automatische meiden belegte Nummern', () => {
    const ast = buildTestAst([
      { track: { name: 'Kick' }, blocks: [{ type: 'code', params: { code: 's("bd*4").duck(2)' } }, { type: 'room' }] },
      { track: { name: 'Pad' }, blocks: [{ type: 'code', params: { code: 'note("c3").s("sawtooth").o(2)' } }, { type: 'room' }] },
      { track: { name: 'Lead' }, blocks: [{ type: 'melody' }, { type: 'room' }] },
    ]);
    const code = compile(ast, { bpm: 120 }).code;
    expect(line(code, 1)).toMatch(/\.o\(2\)\.room\(0\.4\)\.roomsize\(3\)\.gain/); // kein .orbit() angehängt
    expect(code).not.toMatch(/\.orbit\(2\)/);
    expect(line(code, 0)).toContain('.orbit(3)');
    expect(line(code, 2)).toContain('.orbit(4)');
  });
});

describe('Arrangement (Song-Ablauf)', () => {
  function arranged(loopSection: string | null = null) {
    const ast = buildTestAst([
      { track: { name: 'Kick' }, blocks: [{ type: 'code', params: { code: 's("bd*4")' } }] },
      { track: { name: 'Hi-Hat' }, blocks: [{ type: 'code', params: { code: 's("hh*8")' } }] },
      { track: { name: 'Pad' }, blocks: [{ type: 'code', params: { code: 'note("c3").s("sine")' } }] },
    ]);
    const [kick, hat] = ast.nodes.filter((n) => n.type === 'track').map((n) => n.id);
    ast.arrangement = {
      sections: [
        { id: 's1', cycles: 2 },
        { id: 's2', cycles: 1 },
      ],
      cells: {
        [kick!]: { s1: { on: true }, s2: { on: false } },
        [hat!]: { s1: { on: false }, s2: { on: true, code: '.lpf(2000)' } },
        // Pad ohne Eintrag → spielt durchgehend
      },
      loopSection,
    };
    return compile(ast, { bpm: 120 }).code;
  }

  it('erzeugt pro Spur const + arrange(), Spuren ohne Eintrag spielen durchgehend', () => {
    const code = arranged();
    expect(code).toContain('// Kick\nconst kickPart = s("bd*4")\n$: arrange([2, kickPart], [1, silence]).gain(0.8)');
    expect(code).toContain('const hiHatPart = s("hh*8")\n$: arrange([2, silence], [1, hiHatPart.lpf(2000)]).gain(0.8)');
    expect(code).toContain('// Pad\n$: note("c3").s("sine").gain(0.8)');
  });

  it('klingt exakt wie arrange(stack(…)) des Originals', async () => {
    const original = await evaluateStrudel('setcpm(30)\n$: arrange([2, stack(s("bd*4"), note("c3").s("sine"))], [1, stack(s("hh*8").lpf(2000), note("c3").s("sine"))])');
    const ours = await evaluateStrudel(arranged());
    const key = (h: StrudelHap) => `${h.begin}|${h.end}|${String(h.value.s)}|${String(h.value.note ?? '')}|${String(h.value.cutoff ?? '')}`;
    const pick = (q: (a: number, b: number) => StrudelHap[]) => q(0, 6).map(key).sort();
    expect(pick(ours.query)).toEqual(pick(original.query));
  });

  it('Abschnitt in Schleife: nur dieser Abschnitt', () => {
    expect(arranged('s2')).toContain('$: arrange([1, hiHatPart.lpf(2000)])');
  });
});

describe('Arrangement: ab Abschnitt spielen', () => {
  it('beginnt beim Startabschnitt und hängt den Anfang hinten an', () => {
    const ast = buildTestAst([{ track: { name: 'Kick' }, blocks: [{ type: 'code', params: { code: 's("bd")' } }] }]);
    const kick = ast.nodes.find((n) => n.type === 'track')!.id;
    ast.arrangement = {
      sections: [
        { id: 'a', cycles: 1 },
        { id: 'b', cycles: 2 },
        { id: 'c', cycles: 4 },
      ],
      cells: { [kick]: { a: { on: true }, b: { on: false }, c: { on: true, code: '.fast(2)' } } },
      startSection: 'b',
    };
    expect(compile(ast, { bpm: 120 }).code).toContain('$: arrange([2, silence], [4, kickPart.fast(2)], [1, kickPart])');
  });
});

describe('Arrangement: Pausen zusammenfassen', () => {
  it('fasst nur aufeinanderfolgende Pausen zusammen und klingt identisch', async () => {
    const ast = buildTestAst([{ track: { name: 'Hat' }, blocks: [{ type: 'code', params: { code: 's("hh*4")' } }] }]);
    const hat = ast.nodes.find((n) => n.type === 'track')!.id;
    ast.arrangement = {
      sections: [
        { id: 'a', cycles: 1 },
        { id: 'b', cycles: 2 },
        { id: 'c', cycles: 1 },
        { id: 'd', cycles: 1 },
      ],
      cells: { [hat]: { a: { on: false }, b: { on: false }, c: { on: true }, d: { on: true } } },
    };
    const code = compile(ast, { bpm: 120 }).code;
    expect(code).toContain('$: arrange([3, silence], [1, hatPart], [1, hatPart])');
    const original = await evaluateStrudel('setcpm(30)\n$: arrange([1, silence], [2, silence], [1, s("hh*4")], [1, s("hh*4")])');
    const ours = await evaluateStrudel(code);
    const key = (h: StrudelHap) => `${h.begin}|${h.end}|${String(h.value.s)}`;
    expect(ours.query(0, 10).map(key)).toEqual(original.query(0, 10).map(key));
  });
});
