import { existsSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { languageStore, translate } from '../../i18n';
import { resolveTracks } from '../../store/selectors';
import type { BlockNode, DrumGridValue, NoteGridValue, VisualAst } from '../../types/ast';
import { compile } from '../CompilerAgent';
import { ImportError, decodeStrudelInput, importStrudelCode, looksLikeStrudelCode, type ImportResult } from '../importer';
import { drumSound, recipeFor, substituteMini, substituteSound } from '../importer/sounds';
import { expectRoundTrip, expectRoundTripWith } from './importerRoundTrip';
import { evaluateStrudel } from './strudelHarness';

beforeEach(() => languageStore.set('en'));

const fixture = (name: string) => readFileSync(new URL(`./fixtures/importer/${name}`, import.meta.url), 'utf8');

function tracks(ast: VisualAst) {
  return resolveTracks(ast).map(({ track, chain }) => ({ ...track.params, chain }));
}

function chainTypes(result: ImportResult): string[][] {
  return resolveTracks(result.ast).map((t) => t.chain.map((b) => b.type));
}

function block(result: ImportResult, track: number, type: string): BlockNode {
  const b = resolveTracks(result.ast)[track]!.chain.find((x) => x.type === type);
  expect(b, `Spur ${track} hat ${type}`).toBeDefined();
  return b!;
}

function gridRow(b: BlockNode, inst: string): string {
  return (b.params['grid'] as DrumGridValue).rows[inst]!.map((x) => (x ? 'x' : '-')).join('');
}

function keys(result: ImportResult): string[] {
  return result.notes.map((n) => n.message.key);
}

/* ------------------------------------------------------------------ */
/* Eingabe                                                             */
/* ------------------------------------------------------------------ */

describe('decodeStrudelInput', () => {
  const link = (code: string) => `https://strudel.cc/#${encodeURIComponent(Buffer.from(code, 'utf8').toString('base64'))}`;

  it('dekodiert strudel.cc-Links (UTF-8, URL-kodiert)', () => {
    const code = '// Grüße 🎶\n$: s("bd*4").bank("RolandTR909")';
    expect(decodeStrudelInput(link(code))).toBe(code);
    expect(decodeStrudelInput(`  ${link(code)}\n`)).toBe(code);
  });

  it('Link ohne/mit kaputtem Inhalt → null', () => {
    expect(decodeStrudelInput('https://strudel.cc/')).toBeNull();
    expect(decodeStrudelInput('https://strudel.cc/#%%%')).toBeNull();
    expect(decodeStrudelInput('https://strudel.cc/#' + Buffer.from([0xff, 0xfe, 0x00]).toString('base64'))).toBeNull();
  });

  it('normaler Text bleibt unverändert', () => {
    expect(decodeStrudelInput('$: s("bd")')).toBe('$: s("bd")');
    expect(decodeStrudelInput('siehe https://strudel.cc/#abc')).toBe('siehe https://strudel.cc/#abc');
  });
});

describe('looksLikeStrudelCode', () => {
  it.each([
    '$: s("bd sd")',
    's("bd*4, hh*8")',
    'setcpm(120/4)\nnote("c e g").s("piano")',
    '_$drums: sound("bd")',
    'stack(s("bd"), s("hh*8")).room(0.3)',
    'n("0 2 4").scale("C:minor").s("sawtooth"',
    fixture('night-drive.js'),
  ])('erkennt Strudel-Code: %s', (text) => expect(looksLikeStrudelCode(text)).toBe(true));

  it.each([
    '',
    'Hallo zusammen, wie geht es euch?',
    'I love stacks (of pancakes) and notes (from you).',
    'console.log("hello world")',
    'const x = foo(1, 2);',
    'https://example.com/#abc',
    'Die Funktion s() ist kurz.',
  ])('kein Fehlalarm: %s', (text) => expect(looksLikeStrudelCode(text)).toBe(false));
});

/* ------------------------------------------------------------------ */
/* Fehler & Programm-Ebene                                             */
/* ------------------------------------------------------------------ */

describe('Fehler und Top-Level', () => {
  it('Syntaxfehler → ImportError mit Zeile/Spalte', () => {
    let err: unknown;
    try {
      importStrudelCode('setcpm(30)\n$: s("bd sd".lpf(800)\n');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ImportError);
    const e = err as ImportError;
    expect(e.messageKey).toBe('importer.error.syntax');
    expect(e.params?.['line']).toBe(3);
    expect(Number(e.params?.['column'])).toBeGreaterThan(0);
    expect(translate('de', e.messageKey, e.params)).toMatch(/Zeile 3/);
  });

  it('nichts Abspielbares → ImportError', () => {
    expect(() => importStrudelCode('// nur ein Kommentar\nsetcpm(30)')).toThrow(ImportError);
  });

  it('Tempo: setcpm ×4, setcps ×240, Ausdrücke, Begrenzung mit Hinweis', () => {
    expect(importStrudelCode('setcpm(34.5)\n$: s("bd")').settings.bpm).toBe(138);
    expect(importStrudelCode('setcps(124/60/4)\n$: s("bd")').settings.bpm).toBe(124);
    expect(importStrudelCode('$: s("bd")').settings.bpm).toBe(120);
    const fast = importStrudelCode('setcps(2)\n$: s("bd")');
    expect(fast.settings.bpm).toBe(220);
    expect(keys(fast)).toContain('importer.note.tempoAdjusted');
    expect(keys(importStrudelCode('setcpm(30.1)\n$: s("bd")'))).toContain('importer.note.tempoAdjusted');
  });

  it('Labels → Namen, _$ → stumm, Kommentar darüber → Name, gleiche Namen → nur der letzte spielt', () => {
    const r = importStrudelCode(['// Bassline', '$: note("c2")', '$lead: note("c4")', '_$: note("e4")', 'pad: note("g3")', 'pad: note("a3")'].join('\n'));
    expect(tracks(r.ast).map((t) => [t.name, t.muted])).toEqual([
      ['Bassline', false],
      ['Lead', false],
      ['Melody', true],
      ['Pad', true],
      ['Pad 2', false],
    ]);
  });

  it('samples(), unbenutzte Ausdrücke und andere Anweisungen → Hinweise', () => {
    const r = importStrudelCode('samples("github:x/y")\ns("hh")\nif (1) {}\n$: s("bd")');
    expect(keys(r)).toEqual(expect.arrayContaining(['importer.note.samplesDropped', 'importer.note.notPlayed', 'importer.note.statementDropped']));
    expect(r.stats.tracks).toBe(1);
  });

  it('ohne $: spielt nur der letzte Ausdruck', () => {
    const r = importStrudelCode('s("bd")\nnote("c e g").add(note(12))');
    expect(r.stats.tracks).toBe(1);
    expect(String(block(r, 0, 'code').params['code'])).toBe('note("c e g").add(note(12))');
  });

  it('Hinweise sind in en und de übersetzt', () => {
    const r = importStrudelCode(fixture('night-drive.js'));
    for (const n of r.notes) {
      for (const lang of ['en', 'de'] as const) expect(translate(lang, n.message.key, n.message.params)).not.toMatch(/importer\.|\{\w+\}/);
    }
  });

  it('Visualisierungen → ein zusammengefasster Hinweis (mit Anzahl)', () => {
    const r = importStrudelCode('$: s("bd")._pianoroll()\n$: s("hh*2")._pianoroll().color("red")');
    const vis = r.notes.filter((n) => n.message.key === 'importer.note.visualsDropped');
    expect(vis).toHaveLength(1);
    expect(vis[0]!.trackName).toBeUndefined();
    expect(vis[0]!.message.params).toEqual({ count: 3, names: '_pianoroll, color' });
    expect(translate('de', vis[0]!.message.key, vis[0]!.message.params)).toBe('3 Anzeige-Funktionen (_pianoroll, color) weggelassen – sie machen keinen Ton.');
    expect(r.stats.dropped).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Abbildung auf Bausteine                                             */
/* ------------------------------------------------------------------ */

describe('Bausteine', () => {
  it('Drums: Mini-Notation → 16er-Raster, 909-Bank → Kit modern', () => {
    const r = importStrudelCode(fixture('night-drive.js'));
    const d = block(r, 0, 'drums');
    expect(d.params['bank']).toBe('modern');
    expect(gridRow(d, 'bd')).toBe('x---x---x---x---');
    expect(gridRow(d, 'sd')).toBe('----x-------x---');
    expect(gridRow(d, 'hh')).toBe('--x---x---x---x-');
    expect(tracks(r.ast)[0]!.name).toBe('Kick & Snare');
  });

  it('Drums: periodische Alternation/Euklid → Raster, wechselnde Takte → Sample-Muster', () => {
    const r = importStrudelCode(fixture('variants.js'));
    expect(chainTypes(r)[0]).toEqual(['drums']);
    expect(gridRow(block(r, 0, 'drums'), 'bd')).toBe('x-------x-------');
    expect(gridRow(block(r, 0, 'drums'), 'hh')).toBe('x-----x-----x---');
    expect(block(r, 1, 'sample').params['pattern']).toBe('bd [~ bd] ~ <sd cp>');
  });

  it('Melodie: n().scale().s() → Noten-Raster mit passender Auflösung', () => {
    const r = importStrudelCode(fixture('night-drive.js'));
    const m = block(r, 1, 'melody');
    expect(m.params).toMatchObject({ root: 'A', octave: '3', scale: 'minor', sound: 'sawtooth' });
    expect((m.params['grid'] as NoteGridValue).cells).toEqual([[0], [2], [4], [7], [4], [2], [0], []]);
    expect(chainTypes(r)[1]).toEqual(['melody', 'lpf', 'code-fx']);
    expect(block(r, 1, 'lpf').params).toEqual({ cutoff: 1200, resonance: 4 });
  });

  it('Melodie: Alternation → mehrtaktiges Raster; Notennamen → Raster, Effekte als Bausteine', () => {
    const r = importStrudelCode(fixture('variants.js'));
    expect(chainTypes(r)[2]).toEqual(['melody']);
    expect(block(r, 2, 'melody').params['grid']).toMatchObject({ steps: 8, bars: 2 });
    expect(chainTypes(r)[3]).toEqual(['melody', 'code-mod', 'sweep', 'code-fx', 'code-mod', 'room']);
    expect(block(r, 3, 'sweep').params).toMatchObject({ min: 400, max: 2000, cycles: 8, shape: 'sine' });
  });

  it('Akkorde: chord().dict("ireal").voicing() → Akkord-Baustein (Rhythmus, Klang)', () => {
    const r = importStrudelCode(fixture('night-drive.js'));
    expect(block(r, 2, 'chords').params).toMatchObject({ custom: '<Am7 Dm7 G7 C^7>', sound: 'piano', rhythm: 'quarter' });
    expect(block(r, 2, 'room').params).toEqual({ amount: 0.5, size: 4 });
    expect(tracks(r.ast)[2]!.volume).toBe(0.5);
  });

  it('dict("ireal") ist Strudels Standard (gleiche Voicing-Noten)', async () => {
    const prog = '"<Ebm Db Abm7 Bb7 Am7 Dm7 G7 C^7 F#m7b5 Bo7>"';
    const a = (await evaluateStrudel(`$: chord(${prog}).dict("ireal").voicing()`)).query(0, 10);
    const b = (await evaluateStrudel(`$: chord(${prog}).voicing()`)).query(0, 10);
    expect(a.length).toBeGreaterThan(30);
    expect(b).toEqual(a);
  });

  it('Modifier & Effekte inkl. Aliase/Kurzformen', () => {
    const r = importStrudelCode(fixture('modifiers.js'));
    expect(chainTypes(r)[0]).toEqual(['drums', 'fast', 'firstOf', 'sometimes', 'jux', 'ply', 'degrade', 'crush', 'distort', 'pan']);
    expect(block(r, 0, 'firstOf').params).toEqual({ every: 4, action: 'rev' });
    expect(block(r, 0, 'sometimes').params).toEqual({ chance: 0.3, action: 'up' });
    expect(block(r, 0, 'distort').params['amount']).toBe(0.375);
    expect(chainTypes(r)[1]).toEqual(['melody', 'slow', 'sometimes', 'hpf', 'adsr']);
    expect(block(r, 1, 'adsr').params).toEqual({ attack: 0.001, decay: 0.001, sustain: 1, release: 0.4 });
    expect(tracks(r.ast)[1]!.name).toBe('Bass');
  });

  it('slider(), gain → Spur-Lautstärke (>1 begrenzt), orbit bleibt als Code', () => {
    const r = importStrudelCode('$: s("bd*2").lpf(slider(800, 0, 5000)).gain(1.4).orbit(3)');
    expect(block(r, 0, 'lpf').params['cutoff']).toBe(800);
    expect(tracks(r.ast)[0]!.volume).toBe(1);
    expect(keys(r)).toContain('importer.note.gainClamped');
    expect(chainTypes(r)[0]).toEqual(['drums', 'lpf', 'code-fx']);
    expect(String(block(r, 0, 'code-fx').params['code'])).toBe('.orbit(3)');
  });

  it('delay nur mit Zeitangabe als Baustein (sonst Code), delaytime in Sekunden → passende Option', () => {
    const r = importStrudelCode('setcpm(30)\n$: s("bd").delay(0.4)\n$: s("bd").delay(0.4).delaytime(0.375).delayfeedback(0.6)\n$: s("bd").delay(0.5).delaysync(0.25)');
    expect(chainTypes(r)).toEqual([['drums', 'code-fx'], ['drums', 'delay'], ['drums', 'delay']]);
    expect(block(r, 1, 'delay').params).toEqual({ amount: 0.4, time: '0.1875', feedback: 0.6 });
    expect(block(r, 2, 'delay').params).toEqual({ amount: 0.5, time: '0.25', feedback: 0.5 });
  });

  it('Werte außerhalb des Katalogs bleiben Code', () => {
    const r = importStrudelCode('$: note("c3 e3").add(note(7)).lpf(15000).room(1.5).crush(4.5)');
    expect(chainTypes(r)[0]).toEqual(['code', 'code-fx']);
    expect(String(block(r, 0, 'code-fx').params['code'])).toBe('.lpf(15000).room(1.5).crush(4.5)');
  });

  it('Kommentare in Ketten werden entfernt, Quote-Stil bleibt', () => {
    const r = importStrudelCode(`$: note("c3 e3") // Melodie\n  /* gleich: */ .add(note('<0 7>')) // höher\n  .s('piano')`);
    expect(String(block(r, 0, 'code').params['code'])).toBe(`note("c3 e3").add(note('<0 7>')).s('piano')`);
  });

  it('Variablen: Deklarationen im Setup-Code, als Wurzel zusätzlich analysiert (→ Bausteine)', () => {
    const r = importStrudelCode(fixture('variables.js'));
    expect(r.settings.bpm).toBe(128);
    expect(r.settings.prelude).toBe(['const tempo = 128', 'const groove = s("bd ~ sd ~").bank("emu808")', 'const chords = "<C Am F G>"'].join('\n'));
    expect(chainTypes(r)[0]).toEqual(['drums', 'lpf']);
    expect(String(block(r, 1, 'code').params['code'])).toBe('chord(chords).voicing().s("piano")');
  });
});

/* ------------------------------------------------------------------ */
/* Notennamen → Melodie-Raster                                         */
/* ------------------------------------------------------------------ */

describe('note(…) mit Notennamen → Melodie-Baustein', () => {
  const grid = (r: ImportResult, i = 0) => block(r, i, 'melody').params['grid'] as NoteGridValue;

  it('Bass-Beispiel: <eb2 db2 ab2 bb2> → Db(C#)-Dur Lage 2, 4 Takte, Ersatzklang mit Rezept', async () => {
    const code = '$: note("<eb2 db2 ab2 bb2>").s("gm_electric_guitar_jazz").lpf(7000).room(0.15)';
    const r = importStrudelCode(code);
    expect(block(r, 0, 'melody').params).toMatchObject({ root: 'C#', scale: 'major', octave: '2', sound: 'triangle' });
    expect(grid(r)).toEqual({ steps: 1, bars: 4, cells: [[1], [0], [4], [5]], lengths: [[1], [1], [1], [1]] });
    expect(chainTypes(r)[0]).toEqual(['melody', 'adsr', 'lpf', 'room']);
    const n = r.notes.find((x) => x.message.key === 'importer.note.noteMelody')!;
    expect(n.kind).toBe('converted');
    languageStore.set('de');
    expect(translate('de', n.message.key, importStrudelCode(code).notes.find((x) => x.message.key === 'importer.note.noteMelody')!.message.params)).toBe(
      'Noten in einen Melodie-Baustein umgewandelt (C#-Dur, Lage 2) – gleiche Töne wie im Original.',
    );
    await expectRoundTrip(code, { cycles: 8, ignore: ['attack', 'decay', 'sustain', 'release'] });
  });

  it('Achtel-Linie mit Pausen (MIDI-Zahlen gemischt)', async () => {
    const code = '$: note("c4 ~ eb4 g4 ~ 70 c5 ~").s("sawtooth")';
    const r = importStrudelCode(code);
    expect(block(r, 0, 'melody').params).toMatchObject({ root: 'C', scale: 'minor', octave: '4' });
    expect(grid(r)).toEqual({ steps: 8, cells: [[0], [], [2], [4], [], [6], [7], []] });
    await expectRoundTrip(code, { cycles: 4 });
  });

  it('Linie mit Akkorden und Alternation über 2 Takte', async () => {
    const code = '$: note("<[c3,eb3,g3] [bb2,d3,f3]> ~").s("square")';
    const r = importStrudelCode(code);
    expect(chainTypes(r)[0]).toEqual(['melody']);
    expect(grid(r)).toMatchObject({ steps: 2, bars: 2 });
    expect(grid(r).cells.map((c) => c.length)).toEqual([3, 0, 3, 0]);
    await expectRoundTrip(code, { cycles: 8 });
  });

  it('zwei Oktaven (Stufen 0–14) passen ins Raster', async () => {
    const code = '$: note("c3 c4 g4 b4").s("sine")';
    const r = importStrudelCode(code);
    expect(block(r, 0, 'melody').params).toMatchObject({ root: 'C', scale: 'major', octave: '3' });
    expect(grid(r).cells).toEqual([[0], [7], [11], [13]]);
    await expectRoundTrip(code, { cycles: 2 });
  });

  it('Tonart der eigenen Kette vor Tonarten anderer Spuren', () => {
    const r = importStrudelCode('$: note("f3 ab3 c4").scale("F3:minor")\n$: n("0 2").scale("Db3:major")');
    expect(block(r, 0, 'melody').params).toMatchObject({ root: 'F', scale: 'minor', octave: '3' });
  });

  it('Tonart aus dem übrigen Code wird bevorzugt', () => {
    const plain = importStrudelCode('$: note("f3 ab3 c4")');
    expect(block(plain, 0, 'melody').params).toMatchObject({ root: 'F', scale: 'minor' });
    const hinted = importStrudelCode('$: note("f3 ab3 c4")\n$: n("0 2").scale("Db3:major")');
    expect(block(hinted, 0, 'melody').params).toMatchObject({ root: 'C#', scale: 'major', octave: '3' });
    expect(grid(hinted).cells).toEqual([[2], [4], [6]]);
  });

  it('Haltetöne (unterschiedliche Dauern) und /2 → Raster mit Dauern', async () => {
    const code = '$: note("eb4@2 f4@4 gb4@2 [ab4 bb4]/2").s("sine")';
    const r = importStrudelCode(code);
    expect(chainTypes(r)[0]).toEqual(['melody']);
    expect(grid(r).bars).toBe(2);
    expect(grid(r).lengths!.flat().some((l) => l > 1)).toBe(true);
    await expectRoundTrip(code, { cycles: 8 });
  });

  it.each([
    ['zu feines Raster (> 16 Steps pro Takt)', 'note("[c4 e4 g4] [c4 e4 g4 b4 c5]")'],
    ['chromatisch, in keiner Skala', 'note("c4 c#4 d4 d#4")'],
    ['mehr Stufen als das Raster hat (3 Oktaven)', 'note("c2 c5")'],
    ['zufällig', 'note("c4 e4?")'],
  ])('bleibt Code: %s', async (_, expr) => {
    const r = importStrudelCode(`$: ${expr}.s("sine")`);
    expect(chainTypes(r)[0]).toEqual(['code']);
    if (!expr.includes('?')) await expectRoundTrip(`$: ${expr}.s("sine")`, { cycles: 2 });
  });
});

/* ------------------------------------------------------------------ */
/* Setup-Code (prelude)                                                */
/* ------------------------------------------------------------------ */

describe('Setup-Code', () => {
  it('register/const/let/function/Zuweisungen in Original-Reihenfolge, ohne Kommentare; setcpm/samples nicht', () => {
    const r = importStrudelCode(fixture('custom-functions.js'));
    const prelude = r.settings.prelude!;
    expect(prelude.split('\n')[0]).toBe("const ratchet = register('ratchet', (pat) => pat.sometimes(ply(2)))");
    expect(prelude).toContain("register(['wobble', 'wob'], (amt, pat) => pat.lpf(sine.range(400, 400 + amt).fast(2)))");
    expect(prelude).toContain('let accent = 0.9\naccent = 1\nfunction octave(pat) {');
    expect(prelude).not.toMatch(/setcpm|\/\/|Rising/);
    // gain im Setup-Code → velocity relativ zur Standard-Lautstärke (sonst überschreibt die Spur-Lautstärke es)
    expect(prelude).toContain("register('fade', (start, end, mult, section, pat) => pat.velocity(saw.range(start, end).slow(section).mul(mult)).mul(velocity(1.25)))");
    const info = r.notes.find((n) => n.message.key === 'importer.note.preludeKept');
    expect(info?.kind).toBe('info');
    expect(translate('de', info!.message.key, info!.message.params)).toBe(
      'Setup-Code übernommen (eigene Funktionen: ratchet, fade, wobble, wob) – du findest ihn über den Spuren.',
    );
    expect(compile(r.ast, r.settings).code).toMatch(/^setcpm\(120\/4\)\n\n\/\/ Setup\nconst ratchet = /);
  });

  it('samples() bleibt draußen, Klang-Ersatz gilt auch im Setup-Code', () => {
    const r = importStrudelCode('samples("github:x/y")\nconst lead = note("c4").s("gm_lead_2_sawtooth")\n$: lead.lpf(900)');
    expect(r.settings.prelude).toBe('const lead = note("c4").s("sawtooth")');
    expect(keys(r)).toContain('importer.note.samplesDropped');
  });

  it('ohne Setup-Anweisungen kein prelude', () => {
    expect(importStrudelCode('setcpm(30)\n$: s("bd")').settings).toEqual({ bpm: 120 });
  });

  it('registrierte Methoden bleiben als Code-Bausteine an ihrer Stelle', () => {
    const r = importStrudelCode(fixture('custom-functions.js'));
    expect(chainTypes(r)).toEqual([
      ['code', 'code-mod', 'code-fx'], // ratchet nutzt ply → Raster-Dauern würden nicht stimmen → Code
      ['drums', 'code-fx'],
      ['code', 'code-fx', 'room'],
      ['code', 'code-mod'],
      ['melody', 'code-fx'],
    ]);
    expect(String(block(r, 1, 'code-fx').params['code'])).toBe('.fade(0.3, 0.6, 1, 2)');
    expect(String(block(r, 0, 'code-mod').params['code'])).toBe('.ratchet()');
    // gain hinter der eigenen gain-Funktion → deren velocity zurücksetzen
    expect(String(block(r, 4, 'code-fx').params['code'])).toBe('.fade(0.5, 1, 1, 2).velocity(1)');
  });
});

/* ------------------------------------------------------------------ */
/* Song-Ablauf (arrange)                                               */
/* ------------------------------------------------------------------ */

describe('Song-Ablauf (arrange)', () => {
  const cellsOf = (r: ImportResult, track: number) => {
    const id = resolveTracks(r.ast)[track]!.track.id;
    return r.ast.arrangement!.sections.map((sec) => r.ast.arrangement!.cells[id]?.[sec.id]);
  };

  it('jedes Instrument eine Spur, Abschnitte mit Namen aus Kommentaren, Varianten als Zell-Code', () => {
    const r = importStrudelCode(fixture('arrangement.js'));
    expect(tracks(r.ast).map((t) => [t.name, t.muted, t.volume])).toEqual([
      ['Kick', false, 0.9],
      ['Hat', false, 1],
      ['Clap', false, 0.8],
      ['Bass Line', false, 0.6],
      ['Keys', false, 0.4],
      ['Lead', false, 0.8],
      ['Unused', true, 0.8],
      ['Air', false, 0.05],
    ]);
    expect(chainTypes(r).slice(0, 6)).toEqual([['drums'], ['drums', 'code-fx'], ['drums', 'room'], ['melody', 'lpf'], ['chords', 'room'], ['melody', 'delay']]);
    expect(r.ast.arrangement!.sections.map((x) => [x.cycles, x.name])).toEqual([
      [2, 'Intro – just the beat'],
      [2, 'Build'],
      [4, undefined],
      [2, 'Breakdown – hands in the air'],
      [2, undefined],
      [1, undefined],
      [2, 'Outro'],
    ]);
    expect(cellsOf(r, 1)).toEqual([
      { on: false },
      { on: true, code: '.lpf(2000)' },
      { on: true },
      { on: true, code: '.velocity(0.15)' }, // Spur-Lautstärke 1 (gain-Muster) → 0.15
      { on: true },
      { on: false },
      { on: false },
    ]);
    expect(cellsOf(r, 0)[4]).toEqual({ on: true, code: '.mask("1 1 1 0")' });
    expect(cellsOf(r, 5)[4]).toEqual({ on: true, code: '.velocity(0.625).late(swing)' }); // 0.5 / 0.8
    expect(cellsOf(r, 4)[6]).toEqual({ on: true, code: '.room(0.9).velocity(0.5)' }); // 0.2 / 0.4
    // ungenutztes Instrument: stumm, ohne Zellen
    expect(r.ast.arrangement!.cells[resolveTracks(r.ast)[6]!.track.id]).toBeUndefined();
    // Instrument-Deklarationen nicht doppelt im Setup-Code
    expect(r.settings.prelude).toBe('const swing = 0.1');
    const n = r.notes.find((x) => x.message.key === 'importer.note.arrangement')!;
    expect(translate('de', n.message.key, n.message.params)).toBe('Song-Ablauf mit 7 Abschnitten übernommen (7 Instrumente) – du findest ihn über den Spuren.');
  });

  it('Rundreise über zwei Durchläufe (Zeiten, Dauern, Klänge, gain×velocity)', async () => {
    await expectRoundTrip(fixture('arrangement.js'), { cycles: 30 });
  });

  it('unbekannte Bezeichner oder widersprüchliche Doppelungen → eine Code-Spur mit Hinweis', () => {
    const undef = importStrudelCode('let a = s("bd*2")\narrange([2, stack(a, b)])');
    expect(undef.ast.arrangement).toBeUndefined();
    expect(chainTypes(undef)).toEqual([['code']]);
    expect(keys(undef)).toContain('importer.note.arrangementCode');
    const twice = importStrudelCode('let a = s("bd*2")\narrange([2, stack(a, a.fast(2))])');
    expect(twice.ast.arrangement).toBeUndefined();
  });

  it('Methoden hinter arrange (feste Klang-Parameter) gelten in jedem Abschnitt', async () => {
    const code = 'let a = s("bd*2")\nlet b = note("c3 e3").s("sine")\narrange([1, a], [2, stack(a, b.fast(2))]).lpf(900)';
    const r = importStrudelCode(code);
    expect(cellsOf(r, 1)).toEqual([{ on: false }, { on: true, code: '.fast(2).lpf(900)' }]);
    await expectRoundTrip(code, { cycles: 6 });
  });
});

/* ------------------------------------------------------------------ */
/* Eigene Sample-Slots (availableSounds)                               */
/* ------------------------------------------------------------------ */

describe('eigene Klänge (availableSounds)', () => {
  const code = [
    "samples({ vox: 'vox.wav', CHOPS: ['a.wav', 'b.wav'] }, 'https://example.com/')",
    '$: s("vox:3 ~ CHOPS*2").gain(0.5)',
    '$: s("bd sd").bank("tech").room(0.2)',
    '$: note("c3 e3").s("Lead")',
  ].join('\n');
  const available = ['vox', 'CHOPS', 'tech_bd', 'tech_sd', 'lead'];

  it('werden nicht ersetzt (auch vox:3, bank_name), freundlicher samples()-Hinweis', () => {
    const r = importStrudelCode(code, { availableSounds: available });
    expect(r.notes.filter((n) => n.kind === 'substituted')).toEqual([]);
    expect(keys(r)).toContain('importer.note.samplesSlots');
    expect(keys(r)).not.toContain('importer.note.samplesDropped');
    expect(block(r, 0, 'sample').params['pattern']).toBe('vox:3 ~ CHOPS*2');
    expect(String(block(r, 1, 'code').params['code'])).toBe('s("bd sd").bank("tech")');
    expect(block(r, 2, 'melody').params['sound']).toBe('Lead');
    expect(translate('de', 'importer.note.samplesSlots', { code: 'samples(…)' })).toBe('Samples aus samples(…) werden durch deine eigenen Slots ersetzt.');
  });

  it('ohne Slots: Ersatz wie bisher', () => {
    const r = importStrudelCode(code);
    expect(r.stats.substituted).toBeGreaterThan(0);
    expect(keys(r)).toContain('importer.note.samplesDropped');
  });

  it('samples(url): Hinweis auf Slots, wenn alle benutzten Fremd-Klänge Slots sind', () => {
    const r = importStrudelCode('samples("github:someone/kit")\n$: s("tech*4, ~ vox")', { availableSounds: ['tech', 'vox'] });
    expect(keys(r)).toContain('importer.note.samplesSlots');
    const partial = importStrudelCode('samples("github:someone/kit")\n$: s("tech*4, ~ vox")', { availableSounds: ['tech'] });
    expect(keys(partial)).toContain('importer.note.samplesDropped');
  });

  it('Rundreise mit Slots: gleiche Klangnamen wie im Original', async () => {
    const { result } = await expectRoundTripWith(code, available);
    expect(result.stats.substituted).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Sidechain (duck/orbit)                                              */
/* ------------------------------------------------------------------ */

describe('Sidechain', () => {
  it('duck/orbit/o bleiben als Code an ihrer Stelle, theme gilt als Visualisierung', () => {
    const r = importStrudelCode(fixture('sidechain.js'));
    const codeOf = (i: number) => resolveTracks(r.ast)[i]!.chain.filter((b) => b.type.startsWith('code')).map((b) => String(b.params['code']));
    expect(codeOf(0)).toEqual(['.duck(2).duckdepth(0.8).duckattack(0.15)']);
    expect(chainTypes(r)[1]).toEqual(['chords', 'code-fx', 'room', 'lpf']);
    expect(codeOf(1)).toEqual(['.o(2)']);
    expect(codeOf(2)).toEqual(['.orbit(2)']);
    // stack-Zeilen mit eigener Kette → eigene Spuren, jeweils mit ihrem orbit
    expect(codeOf(3)).toEqual(['.o(3)']);
    expect(codeOf(4)).toEqual(['.o(3)']);
    const vis = r.notes.find((n) => n.message.key === 'importer.note.visualsDropped');
    expect(vis?.message.params?.['names']).toBe('theme, _scope');
    const code = compile(r.ast, r.settings).code;
    expect(code).not.toMatch(/theme/);
    expect(code).toMatch(/\.duck\(2\)/);
  });
});

/* ------------------------------------------------------------------ */
/* stack(…)                                                            */
/* ------------------------------------------------------------------ */

describe('stack', () => {
  it('Zeilen mit unterschiedlichen Ketten → eine Spur pro Zeile (eigene Lautstärke/Effekte)', () => {
    const r = importStrudelCode(fixture('drum-stack.js'));
    expect(tracks(r.ast).map((t) => [t.name, t.volume])).toEqual([
      ['Beat · Kick', 1],
      ['Beat · Clap', 0.7],
      ['Beat · Hi-Hat', 0.5],
    ]);
    expect(chainTypes(r)).toEqual([['drums', 'hpf'], ['drums', 'hpf'], ['drums', 'lpf', 'code-mod', 'hpf']]);
    expect(block(r, 0, 'drums').params['bank']).toBe('emu808');
  });

  it('Drum-Zeilen mit gleicher Kette → ein gemeinsames Raster', () => {
    const r = importStrudelCode('$: stack(s("bd*4").gain(0.9).lpf(3000), s("~ sd").gain(0.9).lpf(3000)).room(0.2)');
    expect(chainTypes(r)).toEqual([['drums', 'lpf', 'room']]);
    expect(tracks(r.ast)[0]!.volume).toBe(0.9);
  });

  it('nicht verteilbare Methoden hinter dem stack → eine Code-Spur', () => {
    const r = importStrudelCode('$: stack(note("c3"), note("e3")).arp("0 1")');
    expect(chainTypes(r)).toEqual([['code']]);
  });
});

/* ------------------------------------------------------------------ */
/* Klänge                                                              */
/* ------------------------------------------------------------------ */

describe('Klang-Ersatz', () => {
  it('bekannte freie Klänge bleiben', () => {
    for (const s of ['sawtooth', 'supersaw', 'crackle', 'piano', 'bd', 'analog_hh', 'tabla', 'sbd', 'pink']) {
      expect(substituteSound(s, { bank: false, tonal: true })).toBe(s);
    }
  });

  it('Drumcomputer → Kit-Instrument (808 → emu808, 909 → modern, sonst analog)', () => {
    expect(drumSound('RolandTR909_bd')).toMatchObject({ inst: 'bd', kit: 'modern' });
    expect(drumSound('tr808_cp')).toMatchObject({ inst: 'cp', kit: 'emu808' });
    expect(drumSound('dr550_sd')).toMatchObject({ inst: 'sd', kit: 'analog' });
    expect(drumSound('808oh')).toMatchObject({ inst: 'oh', kit: 'emu808' });
    expect(drumSound('hh', 'RolandTR808')).toMatchObject({ inst: 'hh', kit: 'emu808', exact: false });
    expect(drumSound('hh', 'analog')).toMatchObject({ exact: true });
    expect(drumSound('speech')).toBeNull();
    expect(substituteSound('rm50_hh', { bank: false, tonal: false })).toBe('analog_hh');
    expect(substituteSound('lt', { bank: false, tonal: false })).toBe('tabla:1');
    expect(substituteSound('cr', { bank: true, tonal: false })).toBe('oh');
  });

  it('gm_* → Synth bzw. Piano, Unbekanntes → triangle (tonal) / perc (perkussiv)', () => {
    expect(substituteSound('gm_overdriven_guitar', { bank: false, tonal: true })).toBe('sawtooth');
    expect(substituteSound('gm_electric_guitar_jazz', { bank: false, tonal: true })).toBe('triangle');
    expect(substituteSound('gm_epiano1', { bank: false, tonal: true })).toBe('piano');
    expect(substituteSound('gm_bassoon', { bank: false, tonal: true })).toBe('sawtooth');
    expect(substituteSound('superfoo', { bank: false, tonal: true })).toBe('triangle');
    expect(substituteSound('click', { bank: false, tonal: false })).toBe('perc');
    expect(substituteSound('jvbass', { bank: false, tonal: false })).toBe('bass');
  });

  it('Mini-Notation: nur Klangnamen ersetzen, Index & Struktur bleiben', () => {
    expect(substituteMini('<gm_piano:2 [rm50_hh ~]*2> sawtooth', { bank: false, tonal: true })).toEqual({
      text: '<piano:2 [analog_hh ~]*2> sawtooth',
      replaced: [
        ['gm_piano', 'piano'],
        ['rm50_hh', 'analog_hh'],
      ],
    });
  });

  it('Rezept: Ersatz-Synth + Bausteine direkt hinter der Quelle, nicht für vorhandene Parameter', () => {
    expect(recipeFor('gm_overdriven_guitar')?.id).toBe('distortedGuitar');
    expect(recipeFor('gm_acoustic_grand_piano')).toBeNull();
    const r = importStrudelCode('$: note("e2 g2").s("gm_overdriven_guitar").room(0.3)\n$: note("c4").s("gm_violin").attack(0.5).lpf(900)');
    expect(chainTypes(r)).toEqual([['melody', 'distort', 'lpf', 'adsr', 'room'], ['melody', 'adsr', 'lpf']]);
    expect(block(r, 1, 'adsr').params['attack']).toBe(0.5); // eigener Wert, nicht das Rezept
    expect(r.notes.find((n) => n.trackName === tracks(r.ast)[0]!.name && n.kind === 'substituted')?.message.key).toBe('importer.note.recipe.distortedGuitar');
    expect(translate('en', 'importer.note.recipe.distortedGuitar', { from: 'gm_overdriven_guitar', to: 'sawtooth' })).toMatch(
      /replaced with a sawtooth sound shaped like a distorted guitar/,
    );
  });

  it('Klänge werden auch tief im Code ersetzt (Bank-Kontext beachtet)', () => {
    const r = importStrudelCode('$: stack(s("bd lt").bank("RolandTR909"), note("c3").s("gm_flute")).arp("0")');
    const code = String(block(r, 0, 'code').params['code']);
    expect(code).toBe('stack(s("bd bd").bank("modern"), note("c3").s("sine")).arp("0")');
  });
});

/* ------------------------------------------------------------------ */
/* Rundreise: gleiche Events wie das Original                          */
/* ------------------------------------------------------------------ */

describe('Rundreise (Strudel-Events identisch)', () => {
  it.each(['night-drive.js', 'drum-stack.js', 'variants.js', 'modifiers.js', 'variables.js', 'custom-functions.js', 'sidechain.js'])('%s', async (name) => {
    await expectRoundTrip(fixture(name), { cycles: 8 });
  });

  it.each([
    '$: s("bd*2 [~ bd] sd, hh*8").bank("RolandTR808").lpf(2000).lpq(5).hpf(100).room(0.3).size(6).pan(0.7)',
    '$: s("bd(3,8), ~ cp").fast(1.5).slow(0.5).ply(3).degrade().often(x => x.ply(2))',
    '$: n("0 [2,4] ~ 7").scale("F#3:dorian").s("supersaw").attack(0.2).sustain(0.5).delay(0.5).delaysync(0.125).delayfeedback(0.7)',
    '$: n("0 1 2 3 4 5 6 7 6 5 4 3 2 1 0 ~").scale("Bb2:harmonic:minor").s("square").rev().jux(x => x.rev())',
    '$: chord("<Dm9 G13>").voicing().s("supersaw").struct("[~ x]*4").lpf(sine.slow(4).range(500, 3000))',
    '$: chord("C Am").voicing()',
    '$: sound("tabla:2*4 elec").speed(1.5).almostNever(x => x.speed(3)).gain(0.4)',
    '$: note("c3 [e3 g3]").s("gm_acoustic_bass").gain("<0.5 1>").distort(0.5)',
    '$: s("hh*16").gain(sine.range(0.2, 0.8)).every(3, fast(2))',
    '$: s("bd").gain(0)',
    '$: s("bd ~ ~ ~ sd ~ ~ ~").ply(2).vowel("a")',
    '$: s("bd*2 sd").sometimesBy(0.5, x => x.ply(2))',
  ])('%s', async (code) => {
    await expectRoundTrip(code, { cycles: 6, ignore: ['attack', 'decay', 'sustain', 'release', 'cutoff', 'resonance'].filter(() => code.includes('gm_')) });
  });
});

/* ------------------------------------------------------------------ */
/* Beispiel (nur lokal – fremdes Werk, nicht im Repo)                  */
/* ------------------------------------------------------------------ */

const EXAMPLE = process.env['STRUDEL_IMPORT_EXAMPLE'] ?? 'node_modules/.cache/strudelmixr-local/import-example-feelgood.js';

describe.runIf(existsSync(EXAMPLE))('lokales Beispiel (feelgood)', () => {
  const code = existsSync(EXAMPLE) ? readFileSync(EXAMPLE, 'utf8') : '';

  it('importiert Spuren, Raster, Akkorde, Ersatzklänge, bpm 138', () => {
    const r = importStrudelCode(code);
    expect(r.settings.bpm).toBe(138);
    const ts = tracks(r.ast);
    expect(ts.map((t) => t.name)).toEqual(['Crackle', 'Melody', 'Chords', 'Bass', 'Drums · Kick', 'Drums · Snare', 'Drums · Hi-Hat']);
    expect(ts.map((t) => t.volume)).toEqual([0.8, 0.7, 0.3, 1, 0.9, 0.75, 0.4]);
    expect(chainTypes(r)).toEqual([
      ['sample'],
      ['melody', 'distort', 'adsr', 'code-fx', 'room', 'code-fx'],
      ['chords', 'lpf', 'room'],
      ['melody', 'adsr', 'lpf', 'room', 'code-fx'],
      ['drums', 'lpf', 'code-fx'], // .orbit(0.5) bleibt erhalten
      ['drums', 'room', 'lpf'],
      ['drums', 'code-mod', 'lpf'],
    ]);
    expect(block(r, 2, 'chords').params).toMatchObject({ custom: '<Ebm Db Abm7 Bb7>', sound: 'supersaw' });
    // Melodie: cat aus 16 note-Phrasen mit Haltetönen → Raster über 16 Takte in Eb-Moll (eigenes .scale())
    expect(block(r, 1, 'melody').params).toMatchObject({ root: 'Eb', scale: 'minor', octave: '3' });
    const g = block(r, 1, 'melody').params['grid'] as NoteGridValue;
    expect(g).toMatchObject({ steps: 16, bars: 16 });
    const degrees = g.cells.flat();
    expect([Math.min(...degrees), Math.max(...degrees)]).toEqual([6, 13]);
    // Bass: Eb-Moll aus der Melodie-Spur, Lage 1 (db2 = Stufe 6)
    expect(block(r, 3, 'melody').params).toMatchObject({ root: 'Eb', scale: 'minor', octave: '1' });
    expect((block(r, 3, 'melody').params['grid'] as NoteGridValue).cells).toEqual([[7], [6], [10], [11]]);
    expect(block(r, 2, 'lpf').params['cutoff']).toBe(3000);
    const { code: out } = { code: compile(r.ast, r.settings).code };
    expect(out).not.toMatch(/gm_|dr550|rm50|pianoroll|color|dict/);
  });

  it('Rundreise: gleiche Events (außer Ersatzklang-Formung)', async () => {
    await expectRoundTrip(code, { cycles: 16, ignore: ['distort', 'attack', 'decay', 'sustain', 'release'] });
  });
});
