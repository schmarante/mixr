import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_CATALOG, OPTION_SETS, emptyDrumGrid, emptyNoteGrid } from '../../blocks/catalog';
import type { BlockType, NumberParamDef, ParamValues } from '../../types/ast';
import { languageStore } from '../../i18n';
import { compile } from '../CompilerAgent';
import { buildTestAst, SETTINGS, type TestBlock, type TestTrack } from './astBuilder';
import { evaluateStrudel, transpile, type StrudelHap } from './strudelHarness';

/**
 * Die Bausteine der zweiten Ausbaustufe (Rhythmus, Tonhöhe, Samples, Klang,
 * „Beliebiger Parameter“) – jeweils gegen die echte Strudel-Version geprüft.
 */

beforeEach(() => languageStore.set('de'));

/* ------------------------------------------------------------------ */
/* Helfer                                                              */
/* ------------------------------------------------------------------ */

function run(tracks: TestTrack[]) {
  return compile(buildTestAst(tracks), SETTINGS);
}

/** `$:`-Zeile der n-ten Spur. */
function line(code: string, n = 0): string {
  return code.split('\n').filter((l) => l.startsWith('$: '))[n]!;
}

/** Kompiliert (ohne Diagnose), prüft Transpiler + Evaluation, liefert Events. */
async function events(blocks: TestBlock[], from = 0, to = 1): Promise<StrudelHap[]> {
  const r = run([{ blocks }]);
  expect(r.diagnostics).toEqual([]);
  expect(() => transpile(r.code)).not.toThrow();
  const { query } = await evaluateStrudel(r.code);
  return query(from, to);
}

/** Code-Zeile + Events einer Kette. */
async function chain(blocks: TestBlock[], from = 0, to = 1) {
  return { code: line(run([{ blocks }]).code), haps: await events(blocks, from, to) };
}

function grid(rows: Record<string, string>) {
  const g = emptyDrumGrid();
  for (const [name, pattern] of Object.entries(rows)) g.rows[name] = [...pattern].map((c) => c === 'x');
  return g;
}

function notes(cells: Array<number | number[] | null>) {
  const g = emptyNoteGrid(cells.length);
  g.cells = cells.map((c) => (c === null ? [] : Array.isArray(c) ? c : [c]));
  return g;
}

const kick = (): TestBlock => ({ type: 'drums', params: { grid: grid({ bd: 'x---x---x---x---' }), bank: 'default' } });
const sample = (pattern: string, speed = 1): TestBlock => ({ type: 'sample', params: { pattern, speed } });
const melody = (cells: Array<number | number[] | null> = [0, 2, 4, 7]): TestBlock => ({
  type: 'melody',
  params: { grid: notes(cells), root: 'C', scale: 'major', octave: '3', sound: 'triangle' },
});
const block = (type: BlockType, params: ParamValues = {}): TestBlock => ({ type, params });

/** Diagnose(n) eines einzelnen Blocks hinter einer Quelle. */
function diagnose(source: TestBlock, b: TestBlock) {
  const r = run([{ blocks: [source, b, block('pan', { position: 0.3 })] }]);
  return { code: line(r.code), diagnostics: r.diagnostics };
}

const NEW_TYPES: BlockType[] = [
  'euclid', 'off', 'echo', 'chunk', 'iter', 'palindrome', 'swing', 'linger', 'segment', 'shuffle', 'mask',
  'transpose', 'scaleTranspose', 'arp', 'superimpose', 'vib', 'chop', 'striate', 'slice', 'loopAt',
  'filterEnv', 'phaser', 'vowel', 'tremolo', 'compressor', 'coarse', 'postgain', 'fm', 'sampleRange', 'cut', 'param',
];

/* ------------------------------------------------------------------ */
/* Alle neuen Bausteine mit allen Quellen                              */
/* ------------------------------------------------------------------ */

describe('neue Bausteine × Klangquellen', () => {
  const sources: TestBlock[] = [kick(), melody(), { type: 'chords' }, sample('casio ~ casio:1 ~'), { type: 'code' }];

  it('alle neuen Typen sind im Katalog', () => {
    for (const type of NEW_TYPES) expect(BLOCK_CATALOG[type], type).toBeDefined();
  });

  it.each(NEW_TYPES)('%s: gültiger Code mit jeder Quelle (oder freundliche Diagnose)', async (type) => {
    for (const source of sources) {
      const r = run([{ blocks: [source, { type }] }]);
      if (r.diagnostics.length > 0) {
        // einzige erlaubte Ablehnung: Tonleiter-Schritte ohne Tonleiter
        expect(type).toBe('scaleTranspose');
        expect(r.diagnostics[0]!.message).toMatch(/Tonleiter/);
        continue;
      }
      expect(() => transpile(r.code), `${type} nach ${source.type}`).not.toThrow();
      const { query } = await evaluateStrudel(r.code);
      expect(() => query(0, 2), `${type} nach ${source.type}`).not.toThrow();
    }
  });

  it.each(NEW_TYPES)('%s: jede Auswahl-Option erzeugt gültigen Code', async (type) => {
    for (const p of BLOCK_CATALOG[type].params) {
      if (p.type !== 'select') continue;
      for (const o of OPTION_SETS[p.optionSet]) {
        const blocks = [melody(), block(type, { [p.key]: o.value })];
        const haps = await events(blocks, 0, 2);
        expect(haps.length, `${type}.${p.key}=${o.value}`).toBeGreaterThan(0);
      }
    }
  });

  it.each(NEW_TYPES)('%s: Grenzwerte (min/max, außerhalb → begrenzt) bleiben gültig', async (type) => {
    const numbers = BLOCK_CATALOG[type].params.filter((p): p is NumberParamDef => p.type === 'number');
    for (const extreme of ['min', 'max', 'below', 'above'] as const) {
      const params: ParamValues = {};
      for (const p of numbers) {
        params[p.key] = extreme === 'min' ? p.min : extreme === 'max' ? p.max : extreme === 'below' ? p.min - 100 : p.max + 100;
      }
      const r = run([{ blocks: [melody(), block(type, params)] }]);
      // Ausschnitt mit Anfang = Ende ist bewusst ungültig
      if (type === 'sampleRange') continue;
      expect(r.diagnostics, `${type} ${extreme}`).toEqual([]);
      expect(() => transpile(r.code)).not.toThrow();
      await evaluateStrudel(r.code);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Rhythmus                                                            */
/* ------------------------------------------------------------------ */

describe('Rhythmus-Bausteine', () => {
  it('Euklid: euclid / euclidRot, Schläge > Schritte werden begrenzt', async () => {
    const plain = await chain([sample('casio'), block('euclid')]);
    expect(plain.code).toBe('$: s("casio").euclid(3, 8).gain(0.8)');
    expect(plain.haps.map((h) => h.begin)).toEqual([0, 0.375, 0.75]);

    const rot = await chain([sample('casio'), block('euclid', { pulses: 3, steps: 8, rotation: 2 })]);
    expect(rot.code).toContain('.euclidRot(3, 8, 2)');
    expect(rot.haps.map((h) => h.begin)).toEqual([0, 0.25, 0.625]);

    expect(line(run([{ blocks: [sample('casio'), block('euclid', { pulses: 12, steps: 8, rotation: 10 })] }]).code)).toContain(
      '.euclidRot(8, 8, 2)',
    );
  });

  it('Euklid auf Drums: Raster wird exakt (nicht ausgedünnt) ausgegeben', () => {
    expect(line(run([{ blocks: [kick(), block('euclid')] }]).code)).toBe('$: s("[bd ~ ~ ~]*4").euclid(3, 8).gain(0.8)');
  });

  it('Versetzte Kopie: Melodie per transpose, Drums/Samples per speed', async () => {
    const mel = await chain([melody([0]), block('off')]);
    expect(mel.code).toContain('.off(0.125, x => x.transpose(12))');
    expect(mel.haps.map((h) => [h.begin, h.value.note])).toEqual([
      [0, 'C3'],
      [0.125, 'C4'],
    ]);
    expect(line(run([{ blocks: [kick(), block('off', { interval: '-12', time: '0.25' })] }]).code)).toContain(
      '.off(0.25, x => x.speed(0.5))',
    );
    expect(line(run([{ blocks: [sample('casio', 0.5), block('off')] }]).code)).toContain('.off(0.125, x => x.speed(1))');
    expect(line(run([{ blocks: [kick(), block('off', { interval: '7' })] }]).code)).toContain('x => x.speed(1.4983)');
    const same = await chain([sample('casio'), block('off', { interval: '0', time: '0.0625' })]);
    expect(same.code).toContain('.off(0.0625, x => x)');
    expect(same.haps.map((h) => h.begin)).toEqual([0, 0.0625]);
  });

  it('Wiederholungen: leiser über velocity, die Spur-Lautstärke bleibt erhalten', async () => {
    const { code, haps } = await chain([sample('casio'), block('echo')]);
    expect(code).toBe('$: s("casio").echoWith(3, 0.125, (x, i) => x.velocity(0.6 ** i)).gain(0.8)');
    expect(haps.map((h) => h.begin)).toEqual([0, 0.125, 0.25]);
    expect(haps.map((h) => h.value.velocity as number)).toEqual([1, 0.6, expect.closeTo(0.36, 6)]);
    expect(haps.every((h) => h.value.gain === 0.8)).toBe(true);
  });

  it('Stück für Stück: fastChunk wiederholt keine Takte der Quelle', async () => {
    const { code, haps } = await chain([sample('a b c d'), block('chunk')]);
    expect(code).toContain('.fastChunk(4, x => x.fast(2))');
    expect(haps).toHaveLength(5);
    // Takt 2 der Quelle bleibt Takt 2 (keine repeatCycles wie bei chunk)
    const two = await events([sample('<a b>'), block('chunk', { parts: 2, action: 'rev' })], 1, 2);
    expect(two.every((h) => h.value.s === 'b')).toBe(true);
    expect(line(run([{ blocks: [kick(), block('chunk', { action: 'up' })] }]).code)).toContain('.fastChunk(4, x => x.speed(2))');
  });

  it('Weiterrücken: iter / iterBack (Schalter, auch als Text)', async () => {
    const fwd = await chain([sample('a b c d'), block('iter')], 1, 2);
    expect(fwd.code).toContain('.iter(4)');
    expect(fwd.haps.map((h) => h.value.s)).toEqual(['b', 'c', 'd', 'a']);
    const back = await chain([sample('a b c d'), block('iter', { backwards: true })], 1, 2);
    expect(back.code).toContain('.iterBack(4)');
    expect(back.haps.map((h) => h.value.s)).toEqual(['d', 'a', 'b', 'c']);
    expect(line(run([{ blocks: [sample('a'), block('iter', { backwards: 'true' })] }]).code)).toContain('.iterBack(4)');
  });

  it('Weiterrücken: ungültiger Schalter → Diagnose', () => {
    const r = diagnose(sample('a'), block('iter', { backwards: 'vielleicht' }));
    expect(r.code).toBe('$: s("a").pan(0.3).gain(0.8)');
    expect(r.diagnostics[0]!.message).toMatch(/weder an noch aus/);
  });

  it('Hin und zurück', async () => {
    const { code, haps } = await chain([sample('a b c'), block('palindrome')], 1, 2);
    expect(code).toContain('.palindrome()');
    expect(haps.map((h) => h.value.s)).toEqual(['c', 'b', 'a']);
  });

  it('Swing: zweite Achtel wird verzögert', async () => {
    const { code, haps } = await chain([sample('hh*8'), block('swing')]);
    expect(code).toContain('.swingBy(0.33, 4)');
    expect(haps[0]!.begin).toBe(0);
    expect(haps[1]!.begin).toBeCloseTo(0.125 + 0.33 / 2 / 4, 6);
    expect(line(run([{ blocks: [sample('hh*16'), block('swing', { grid: '8', amount: 0.5 })] }]).code)).toContain('.swingBy(0.5, 8)');
  });

  it('Anfang wiederholen', async () => {
    const { code, haps } = await chain([sample('a b c d'), block('linger')]);
    expect(code).toContain('.linger(0.25)');
    expect(haps.map((h) => h.value.s)).toEqual(['a', 'a', 'a', 'a']);
    expect((await events([sample('a b c d'), block('linger', { part: '0.5' })])).map((h) => h.value.s)).toEqual(['a', 'b', 'a', 'b']);
  });

  it('In Schritte teilen', async () => {
    const { code, haps } = await chain([melody([0]), block('segment', { steps: 4 })]);
    expect(code).toContain('.segment(4)');
    expect(haps.map((h) => [h.begin, h.value.note])).toEqual([
      [0, 'C3'],
      [0.25, 'C3'],
      [0.5, 'C3'],
      [0.75, 'C3'],
    ]);
  });

  it('Mischen: shuffle spielt jeden Teil genau einmal, scramble zufällig', async () => {
    const shuffled = await chain([sample('a b c d'), block('shuffle')], 3, 4);
    expect(shuffled.code).toContain('.shuffle(4)');
    expect(shuffled.haps.map((h) => h.value.s).sort()).toEqual(['a', 'b', 'c', 'd']);
    const scrambled = await chain([sample('a b c d'), block('shuffle', { mode: 'scramble', parts: 4 })]);
    expect(scrambled.code).toContain('.scramble(4)');
    expect(scrambled.haps).toHaveLength(4);
  });

  it('Stumm-Muster: Default macht jeden 4. Takt zur Hälfte stumm', async () => {
    const { code } = await chain([sample('a b c d'), block('mask')]);
    expect(code).toContain('.mask("<1 1 1 [1 0]>")');
    expect(await events([sample('a b c d'), block('mask')], 0, 1)).toHaveLength(4);
    expect((await events([sample('a b c d'), block('mask')], 3, 4)).map((h) => h.value.s)).toEqual(['a', 'b']);
    const custom = await events([sample('a b c d'), block('mask', { pattern: '1 0 1 1' })]);
    expect(custom.map((h) => h.value.s)).toEqual(['a', 'c', 'd']);
  });

  it('Stumm-Muster: Escaping und Klammer-Prüfung', () => {
    const evil = run([{ blocks: [sample('a'), block('mask', { pattern: '1 0"; hush(); "' })] }]);
    expect(() => transpile(evil.code)).not.toThrow();
    expect(line(evil.code)).toContain('.mask("1 0; hush();")');
    const broken = diagnose(sample('a'), block('mask', { pattern: '<1 0' }));
    expect(broken.diagnostics[0]!.message).toMatch(/Klammern/);
    expect(diagnose(sample('a'), block('mask', { pattern: '  ' })).diagnostics[0]!.message).toMatch(/leer/);
  });
});

/* ------------------------------------------------------------------ */
/* Tonhöhe                                                             */
/* ------------------------------------------------------------------ */

describe('Tonhöhen-Bausteine', () => {
  it('Transponieren: Noten per transpose, Grenzen ±24', async () => {
    const { code, haps } = await chain([melody([0]), block('transpose', { semitones: 7 })]);
    expect(code).toContain('.transpose(7)');
    expect(haps[0]!.value.note).toBe('G3');
    expect(line(run([{ blocks: [melody([0]), block('transpose', { semitones: -99 })] }]).code)).toContain('.transpose(-24)');
    const chords = await events([{ type: 'chords' }, block('transpose', { semitones: 12 })]);
    const plain = await events([{ type: 'chords' }]);
    expect(chords.map((h) => h.value.note)).not.toEqual(plain.map((h) => h.value.note));
  });

  it('Transponieren: Drums und Samples per speed (relativ zur Sample-Tonhöhe)', async () => {
    const drums = await chain([kick(), block('transpose', { semitones: -12 })]);
    expect(drums.code).toBe('$: s("bd*4").speed(0.5).gain(0.8)');
    expect(drums.haps.every((h) => h.value.speed === 0.5)).toBe(true);
    expect(line(run([{ blocks: [sample('casio', 1.5), block('transpose')] }]).code)).toContain('.speed(1.5).speed(3)');
  });

  it('Tonleiter-Schritte: bleibt in der Tonart', async () => {
    const { code, haps } = await chain([melody([0, 1]), block('scaleTranspose')]);
    expect(code).toContain('.scaleTranspose(2)');
    expect(haps.map((h) => h.value.note)).toEqual(['E3', 'F3']);
    expect((await events([melody([0]), block('scaleTranspose', { steps: -7 })]))[0]!.value.note).toBe('C2');
  });

  it('Tonleiter-Schritte: ohne Tonleiter (Drums, Akkorde, Sample) → Diagnose statt stummer Spur', () => {
    for (const source of [kick(), { type: 'chords' } as TestBlock, sample('casio')]) {
      const r = diagnose(source, block('scaleTranspose'));
      expect(r.diagnostics).toHaveLength(1);
      expect(r.diagnostics[0]).toMatchObject({ nodeId: 't1-b2', message: expect.stringMatching(/Melodie/) });
      expect(r.code).not.toContain('scaleTranspose');
    }
    // freier Code darf eine eigene .scale() mitbringen
    const code = run([{ blocks: [{ type: 'code', params: { code: 'n("0 2").scale("C:major")' } }, block('scaleTranspose')] }]);
    expect(code.diagnostics).toEqual([]);
  });

  it('Arpeggio: Akkorde Ton für Ton', async () => {
    const { code, haps } = await chain([{ type: 'chords' }, block('arp')]);
    expect(code).toContain('.arp("[0 1 2 3]*2")');
    expect(haps).toHaveLength(8);
    expect(new Set(haps.map((h) => h.begin)).size).toBe(8);
    const notesUp = haps.slice(0, 4).map((h) => h.value.note);
    const down = await events([{ type: 'chords' }, block('arp', { mode: 'down', speed: 1 })]);
    expect(line(run([{ blocks: [{ type: 'chords' }, block('arp', { mode: 'down', speed: 1 })] }]).code)).toContain('.arp("3 2 1 0")');
    expect(down.map((h) => h.value.note)).toEqual([...notesUp].reverse());
  });

  it('Arpeggio: eigene Reihenfolge ersetzt die Auswahl, sicher escaped', async () => {
    expect(line(run([{ blocks: [{ type: 'chords' }, block('arp', { custom: '0 2', speed: 1 })] }]).code)).toContain('.arp("0 2")');
    const evil = run([{ blocks: [{ type: 'chords' }, block('arp', { custom: '0" + evil + "' })] }]);
    expect(() => transpile(evil.code)).not.toThrow();
    expect(line(evil.code)).toContain('.arp("[0 + evil +]*2")');
  });

  it('Doppeln: Kopie in anderer Tonhöhe', async () => {
    const { code, haps } = await chain([melody([0]), block('superimpose', { interval: '7' })]);
    expect(code).toContain('.superimpose(x => x.transpose(7))');
    expect(haps.map((h) => h.value.note).sort()).toEqual(['C3', 'G3']);
    expect(line(run([{ blocks: [kick(), block('superimpose')] }]).code)).toContain('.superimpose(x => x.speed(2))');
  });

  it('Vibrato', async () => {
    const { code, haps } = await chain([melody([0]), block('vib')]);
    expect(code).toContain('.vib(5).vibmod(0.3)');
    expect(haps[0]!.value).toMatchObject({ vib: 5, vibmod: 0.3 });
  });
});

/* ------------------------------------------------------------------ */
/* Samples                                                             */
/* ------------------------------------------------------------------ */

describe('Sample-Bausteine', () => {
  it('Zerhacken', async () => {
    const { code, haps } = await chain([sample('casio'), block('chop')]);
    expect(code).toContain('.chop(4)');
    expect(haps.map((h) => [h.begin, h.value.begin, h.value.end])).toEqual([
      [0, 0, 0.25],
      [0.25, 0.25, 0.5],
      [0.5, 0.5, 0.75],
      [0.75, 0.75, 1],
    ]);
    // Drum-Raster bleibt exakt (chop hängt an der Event-Dauer)
    expect(line(run([{ blocks: [kick(), block('chop')] }]).code)).toContain('s("[bd ~ ~ ~]*4").chop(4)');
  });

  it('Verflechten', async () => {
    const { code, haps } = await chain([sample('a b'), block('striate', { parts: 2 })]);
    expect(code).toContain('.striate(2)');
    expect(haps.map((h) => [h.value.s, h.value.begin])).toEqual([
      ['a', 0],
      ['b', 0],
      ['a', 0.5],
      ['b', 0.5],
    ]);
  });

  it('Scheiben: Reihenfolge der Scheiben', async () => {
    const { code, haps } = await chain([sample('casio'), block('slice', { parts: 4, order: '0 2 1 3' })]);
    expect(code).toContain('.slice(4, "0 2 1 3")');
    expect(haps.map((h) => h.value.begin)).toEqual([0, 0.5, 0.25, 0.75]);
    expect(haps.every((h) => h.value.s === 'casio')).toBe(true);
  });

  it('An Takte anpassen', async () => {
    const { code, haps } = await chain([sample('casio'), block('loopAt')], 0, 2);
    expect(code).toContain('.loopAt(2)');
    expect(haps).toEqual([{ begin: 0, end: 2, value: expect.objectContaining({ s: 'casio', unit: 'c', speed: 0.25 }) }]);
  });

  it('Sample-Ausschnitt: begin/end, Ende vor Anfang → Diagnose', async () => {
    const { code, haps } = await chain([sample('casio'), block('sampleRange', { begin: 0.25, end: 0.75 })]);
    expect(code).toContain('.begin(0.25).end(0.75)');
    expect(haps[0]!.value).toMatchObject({ begin: 0.25, end: 0.75 });
    const r = diagnose(sample('casio'), block('sampleRange', { begin: 0.5, end: 0.5 }));
    expect(r.code).toBe('$: s("casio").pan(0.3).gain(0.8)');
    expect(r.diagnostics[0]!.message).toMatch(/Ende muss nach dem Anfang/);
  });

  it('Abschneiden (Choke-Gruppe)', async () => {
    const { code, haps } = await chain([sample('oh'), block('cut', { group: 2 })]);
    expect(code).toContain('.cut(2)');
    expect(haps[0]!.value).toMatchObject({ cut: 2 });
  });
});

/* ------------------------------------------------------------------ */
/* Klang                                                               */
/* ------------------------------------------------------------------ */

describe('Klang-Bausteine', () => {
  const fx = async (b: TestBlock) => chain([melody([0]), b]);

  it('Filter-Hüllkurve', async () => {
    const { code, haps } = await fx(block('filterEnv'));
    expect(code).toContain('.lpf(300).lpenv(4).lpa(0.01).lpd(0.2).lps(0).lpr(0.1)');
    expect(haps[0]!.value).toMatchObject({ cutoff: 300, lpenv: 4, lpattack: 0.01, lpdecay: 0.2, lpsustain: 0, lprelease: 0.1 });
    const q = await fx(block('filterEnv', { resonance: 8, amount: -2 }));
    expect(q.code).toContain('.lpf(300).lpq(8).lpenv(-2)');
    expect(q.haps[0]!.value).toMatchObject({ resonance: 8, lpenv: -2 });
  });

  it('Filter-Fahrt mit Hochpass', async () => {
    const { code, haps } = await chain([kick(), block('sweep', { filter: 'hpf' })]);
    expect(code).toContain('.hpf(sine.range(300, 3000).slow(4))');
    for (const h of haps) expect(h.value.hcutoff).toBeGreaterThanOrEqual(300);
  });

  it('Verzerrung: Art nur, wenn nicht Standard', async () => {
    expect((await fx(block('distort'))).code).toContain('.distort(1.2).gain');
    const fold = await fx(block('distort', { type: 'fold' }));
    expect(fold.code).toContain('.distort(1.2).distorttype("fold")');
    expect(fold.haps[0]!.value).toMatchObject({ distort: 1.2, distorttype: 'fold' });
  });

  it('Stereo-Spiegel: Breite → juxBy', async () => {
    expect((await chain([kick(), block('jux')])).code).toContain('.jux(rev)');
    const half = await chain([kick(), block('jux', { width: 0.5 })]);
    expect(half.code).toContain('.juxBy(0.5, rev)');
    expect(new Set(half.haps.map((h) => h.value.pan))).toEqual(new Set([0.25, 0.75]));
  });

  it('Phaser', async () => {
    const plain = await fx(block('phaser'));
    expect(plain.code).toContain('.phaser(2).gain');
    expect(plain.haps[0]!.value).toMatchObject({ phaserrate: 2 });
    const deep = await fx(block('phaser', { rate: 0.5, depth: 1 }));
    expect(deep.code).toContain('.phaser(0.5).phaserdepth(1)');
  });

  it.each(OPTION_SETS.vowels.map((o) => o.value))('Vokal %s', async (vowel) => {
    const { code, haps } = await fx(block('vowel', { vowel }));
    expect(code).toContain(`.vowel("${vowel}")`);
    expect(haps[0]!.value.vowel).toBe(vowel.startsWith('<') ? 'a' : vowel);
  });

  it('Tremolo im Takt', async () => {
    const { code, haps } = await fx(block('tremolo', { rate: '4', depth: 0.5 }));
    expect(code).toContain('.tremolosync(4).tremolodepth(0.5)');
    expect(haps[0]!.value).toMatchObject({ tremolosync: 4, tremolodepth: 0.5 });
  });

  it('Kompressor: Expertenwerte nur bei Abweichung vom Standard', async () => {
    expect((await fx(block('compressor'))).code).toContain('.compressor(-20).compressorRatio(4).gain');
    const all = await fx(block('compressor', { threshold: -99, ratio: 8, knee: 20, attack: 0.01, release: 0.2 }));
    expect(all.code).toContain('.compressor(-60).compressorRatio(8).compressorKnee(20).compressorAttack(0.01).compressorRelease(0.2)');
    expect(all.haps[0]!.value).toMatchObject({ compressor: -60, compressorRatio: 8, compressorKnee: 20 });
  });

  it('Lo-Fi und Pegel', async () => {
    const { code, haps } = await fx(block('coarse', { amount: 0 }));
    expect(code).toContain('.coarse(1)');
    expect(haps[0]!.value.coarse).toBe(1);
    expect((await fx(block('postgain'))).haps[0]!.value).toMatchObject({ postgain: 1.5 });
  });

  it('FM-Klang', async () => {
    const plain = await fx(block('fm'));
    expect(plain.code).toContain('.fm(2).fmh(1).gain');
    expect(plain.haps[0]!.value).toMatchObject({ fmi: 2, fmh: 1 });
    const bell = await fx(block('fm', { amount: 6, ratio: 3.5, wave: 'square', decay: 0.4, sustain: 0 }));
    expect(bell.code).toContain('.fm(6).fmh(3.5).fmwave("square").fmdecay(0.4).fmsustain(0)');
    expect(bell.haps[0]!.value).toMatchObject({ fmwave: 'square', fmdecay: 0.4, fmsustain: 0 });
  });
});

/* ------------------------------------------------------------------ */
/* Beliebiger Parameter                                                */
/* ------------------------------------------------------------------ */

describe('Beliebiger Parameter', () => {
  const param = (name: string, value: string) => block('param', { name, value });

  it('Default: velocity als Muster', async () => {
    const { code, haps } = await chain([sample('a*2'), block('param')]);
    expect(code).toBe('$: s("a*2").velocity("1 0.6").gain(0.8)');
    expect(haps.map((h) => h.value.velocity)).toEqual([1, 0.6]);
  });

  it('Zahl direkt, alles andere als Mini-Notation', async () => {
    const cases: Array<[string, string, string, Record<string, unknown>]> = [
      ['fmh', '2', '.fmh(2)', { fmh: 2 }],
      ['lpenv', '-0.5', '.lpenv(-0.5)', { lpenv: -0.5 }],
      ['wtdepth', '.25', '.wtdepth(0.25)', { wtdepth: 0.25 }],
      ['ftype', 'ladder', '.ftype("ladder")', { ftype: 'ladder' }],
      ['bpenv', '<2 4>', '.bpenv("<2 4>")', { bpenv: 2 }],
      ['lpf', ' 800 ', '.lpf(800)', { cutoff: 800 }], // Alias, Leerraum egal
    ];
    for (const [name, value, call, expected] of cases) {
      const { code, haps } = await chain([melody([0]), param(name, value)]);
      expect(code).toContain(call);
      expect(haps[0]!.value).toMatchObject(expected);
    }
  });

  it('Anführungszeichen im Wert können keinen Code einschleusen', async () => {
    const r = run([{ blocks: [sample('a'), param('vowel', 'a"; globalThis.pwnedParam = 1; "')] }]);
    expect(line(r.code)).toBe('$: s("a").vowel("a; globalThis.pwnedParam = 1;").gain(0.8)');
    expect(() => transpile(r.code)).not.toThrow();
    await evaluateStrudel(r.code).catch(() => undefined);
    expect((globalThis as Record<string, unknown>).pwnedParam).toBeUndefined();
    const ticks = run([{ blocks: [sample('a'), param('vowel', '`${x}`\\\n e')] }]);
    expect(line(ticks.code)).toContain('.vowel("${x} e")');
  });

  it('Name wird gegen die Control-Liste geprüft – kein Code über den Namen', () => {
    for (const evil of ['lpf(1).evil', 'gain(1);hush()', 'constructor', '__proto__', 'x y']) {
      const r = diagnose(sample('a'), param(evil, '1'));
      expect(r.code, evil).toBe('$: s("a").pan(0.3).gain(0.8)');
      expect(r.diagnostics, evil).toHaveLength(1);
      expect(r.diagnostics[0]!.message).toMatch(/kennt keinen Parameter/);
    }
  });

  it('unbekannter Name → Diagnose mit Vorschlag bei Tippfehlern', () => {
    expect(diagnose(sample('a'), param('lfp', '1')).diagnostics[0]!.message).toBe(
      'Beliebiger Parameter: Strudel kennt keinen Parameter „lfp“ – meintest du „lpf“? Der Block wird übersprungen.',
    );
    expect(diagnose(sample('a'), param('FMH', '1')).diagnostics[0]!.message).toMatch(/meintest du „fmh“/);
    expect(diagnose(sample('a'), param('qwertzuiop', '1')).diagnostics[0]!.message).toBe(
      'Beliebiger Parameter: Strudel kennt keinen Parameter „qwertzuiop“. Der Block wird übersprungen.',
    );
  });

  it('leerer Name / leerer Wert / kaputte Klammern → Diagnose', () => {
    expect(diagnose(sample('a'), param(' ', '1')).diagnostics[0]!.message).toMatch(/„Parameter“ ist leer/);
    expect(diagnose(sample('a'), param('fmh', '')).diagnostics[0]!.message).toMatch(/„Wert“ ist leer/);
    expect(diagnose(sample('a'), param('fmh', '<1 2')).diagnostics[0]!.message).toMatch(/Klammern/);
  });

  it('Diagnose auf Englisch', () => {
    languageStore.set('en');
    expect(diagnose(sample('a'), param('lfp', '1')).diagnostics[0]!.message).toBe(
      'Any parameter: Strudel doesn\'t know a parameter called “lfp” – did you mean “lpf”? This block will be skipped.',
    );
  });

  it('Hall/Echo über den Parameter-Baustein bekommen eigene Orbits', () => {
    const r = run([
      { blocks: [kick(), param('room', '0.5')] },
      { blocks: [melody(), block('room')] },
    ]);
    expect(line(r.code, 0)).toContain('.room(0.5).orbit(2)');
    expect(line(r.code, 1)).toContain('.orbit(3)');
    const delays = run([
      { blocks: [kick(), param('dfb', '0.5')] },
      { blocks: [melody(), block('delay')] },
    ]);
    expect(line(delays.code, 0)).toContain('.orbit(2)');
  });
});

/* ------------------------------------------------------------------ */
/* Bestehende Bausteine: neue Expertenregler sind abwärtskompatibel     */
/* ------------------------------------------------------------------ */

describe('neue Expertenregler alter Bausteine', () => {
  it('ohne die neuen Parameter (alte Projekte) bleibt der Code gleich', () => {
    const ast = buildTestAst([{ blocks: [kick(), { type: 'jux' }, { type: 'sweep' }, { type: 'distort' }] }]);
    for (const n of ast.nodes) {
      if (n.type === 'jux') delete n.params['width'];
      if (n.type === 'sweep') delete n.params['filter'];
      if (n.type === 'distort') delete n.params['type'];
    }
    expect(line(compile(ast, SETTINGS).code)).toBe('$: s("bd*4").jux(rev).lpf(sine.range(300, 3000).slow(4)).distort(1.2).gain(0.8)');
  });

  it('ungültige Werte → Diagnose', () => {
    expect(diagnose(kick(), block('sweep', { filter: 'bpf(1)' })).diagnostics).toHaveLength(1);
    expect(diagnose(kick(), block('distort', { type: 'evil")' })).diagnostics).toHaveLength(1);
  });
});
