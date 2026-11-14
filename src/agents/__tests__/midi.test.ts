import { beforeEach, describe, expect, it } from 'vitest';
import { compile } from '../CompilerAgent';
import { languageStore } from '../../i18n';
import { collectNotes, parseMidi, writeMidi, type MidiEvent, type MidiTrack } from '../../lib/midi/smf';
import { resolveTracks } from '../../store/selectors';
import { TEMPLATES, templateProject } from '../../data/templates';
import { isTrackNode, type DrumGridValue, type NoteGridValue, type VisualAst } from '../../types/ast';
import { MidiImportError, importMidi } from '../midi/import';
import { audibleTracks, exportMidi, interpretValue, suggestMidiBars, trackCode, TICKS_PER_CYCLE } from '../midi/export';
import { loadStrudelEvaluator, toExpressionProgram } from '../midi/strudelEval';
import { evaluateStrudel } from './strudelHarness';
import { TOOLS } from '../WebMcpAgent';
import { projectSettings, visualAstStore } from '../../store/agentBus';
import { clearProject, loadProject } from '../../store/actions';
import { toBase64 } from '../midi/export';

/* ------------------------------------------------------------------ */
/* Hilfen                                                              */
/* ------------------------------------------------------------------ */

const PPQ = 96;

/** [Start in 16teln, Tonhöhe, Dauer in 16teln, Velocity] */
type N = [number, number, number, number?];

interface TrackSpec {
  name?: string;
  channel: number;
  program?: number;
  notes: N[];
}

function midiFile(tracks: TrackSpec[], opts: { bpm?: number; signature?: [number, number]; ppq?: number } = {}): Uint8Array {
  const ppq = opts.ppq ?? PPQ;
  const step = ppq / 4;
  const conductor: MidiTrack = {
    events: [
      { type: 'tempo', tick: 0, microsecondsPerQuarter: Math.round(60_000_000 / (opts.bpm ?? 120)) },
      ...(opts.signature ? [{ type: 'timeSignature' as const, tick: 0, numerator: opts.signature[0], denominator: opts.signature[1], clocks: 24, thirtySeconds: 8 }] : []),
    ],
  };
  const rest = tracks.map((t): MidiTrack => {
    const events: MidiEvent[] = [];
    if (t.name) events.push({ type: 'trackName', tick: 0, text: t.name });
    if (t.program !== undefined) events.push({ type: 'programChange', tick: 0, channel: t.channel, program: t.program });
    for (const [s, pitch, len, vel] of t.notes) {
      events.push({ type: 'noteOn', tick: s * step, channel: t.channel, note: pitch, velocity: vel ?? 100 });
      events.push({ type: 'noteOff', tick: (s + len) * step, channel: t.channel, note: pitch, velocity: 64 });
    }
    return { events };
  });
  return writeMidi({ format: 1, ppq, tracks: [conductor, ...rest] });
}

/** Strudel-Events eines kompilierten Projekts als vergleichbare Noten [Start, Tonhöhe, Dauer] in 16teln. */
async function strudelNotes(ast: VisualAst, settings: { bpm: number }, bars: number, withVelocity = false): Promise<string[]> {
  const { code } = compile(ast, settings);
  const { query } = await evaluateStrudel(code);
  return query(0, bars)
    .map((h) => {
      const n = interpretValue(h.value)!;
      const base = `${Math.round(h.begin * 16)}:${n.pitch}`;
      const len = n.kind === 'melodic' ? `:${Math.round((h.end - h.begin) * 16)}` : '';
      return base + len + (withVelocity ? `:${n.velocity}` : '');
    })
    .sort();
}

function expectedNotes(notes: N[], drums: boolean, withVelocity = false, volume = 1): string[] {
  return notes
    .map(([s, p, len, vel]) => `${s}:${p}${drums ? '' : `:${len}`}${withVelocity ? `:${Math.round((vel ?? 100) * volume)}` : ''}`)
    .sort();
}

function sourceOf(ast: VisualAst, index = 0) {
  const tracks = resolveTracks(ast);
  return tracks[index]!.chain[0]!;
}

/** 4/4-Beat über `bars` Takte: Kick auf Vierteln, Snare 2+4, Hi-Hat Achtel. */
function beat(bars: number): N[] {
  const out: N[] = [];
  for (let b = 0; b < bars; b++) {
    for (const s of [0, 4, 8, 12]) out.push([b * 16 + s, 36, 1]);
    for (const s of [4, 12]) out.push([b * 16 + s, 38, 1]);
    for (let s = 0; s < 16; s += 2) out.push([b * 16 + s, 42, 1]);
  }
  return out;
}

beforeEach(() => languageStore.set('en'));

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

describe('MIDI-Import', () => {
  it('Drums auf Kanal 10 → Drum-Raster exakt, Tempo, Name; Strudel spielt dieselben Schläge', async () => {
    const notes = beat(4);
    const res = importMidi(midiFile([{ name: 'My Beat', channel: 9, notes }], { bpm: 128 }));
    expect(res.settings.bpm).toBe(128);
    expect(res.stats.tracks).toBe(1);
    const track = res.ast.nodes.find(isTrackNode)!;
    expect(track.params.name).toBe('My Beat');
    expect(track.params.volume).toBe(0.79);
    const src = sourceOf(res.ast);
    expect(src.type).toBe('drums');
    const grid = src.params.grid as DrumGridValue;
    const row = (inst: string) => grid.rows[inst]!.map((x) => (x ? 'x' : '-')).join('');
    expect(row('bd')).toBe('x---x---x---x---');
    expect(row('sd')).toBe('----x-------x---');
    expect(row('hh')).toBe('x-x-x-x-x-x-x-x-');
    expect(row('oh')).toBe('----------------');
    expect(src.params.bank).toBe('modern');
    expect(await strudelNotes(res.ast, res.settings, 4)).toEqual(expectedNotes(notes, true));
  });

  it('Melodie mit Haltetönen über Taktgrenzen → Melodie-Baustein (2 Takte), Strudel-Events == MIDI-Noten', async () => {
    // A-Moll: A3 C4 E4 … ; Halteton ab Schritt 12 über 8 Steps (über die Taktgrenze), Akkord in Takt 2
    const notes: N[] = [
      [0, 57, 4],
      [4, 60, 2],
      [6, 64, 2],
      [8, 62, 4],
      [12, 69, 8],
      [20, 67, 4],
      [24, 57, 8],
      [24, 60, 8],
      [24, 64, 6],
    ];
    const res = importMidi(midiFile([{ name: 'Lead', channel: 0, program: 81, notes }]));
    const src = sourceOf(res.ast);
    expect(src.type).toBe('melody');
    const grid = src.params.grid as NoteGridValue;
    expect(grid.bars).toBe(2);
    expect(grid.steps).toBe(16);
    expect(grid.lengths![12]).toEqual([8]);
    expect(src.params.sound).toBe('sawtooth');
    expect(await strudelNotes(res.ast, res.settings, 4)).toEqual(
      expectedNotes([...notes, ...notes.map(([s, p, l]): N => [s + 32, p, l])], false),
    );
  });

  it('Stimme über mehr als zwei Oktaven (Bass + Akkorde + Melodie) → nach Lage geteilt, je ein Melodie-Baustein', async () => {
    // Klavier auf einem Kanal: Dm – Bb – F – C (Bass tief, Akkorde Mitte), Melodie zwei Oktaven höher
    const chords = [
      [38, 53, 57, 62],
      [34, 53, 58, 60],
      [41, 57, 60, 65],
      [43, 53, 60, 64],
    ];
    const notes: N[] = chords.flatMap((c, bar) => c.map((p): N => [bar * 16, p, 16]));
    const melody: Array<[number, number]> = [[77, 6], [76, 6], [77, 4], [86, 12], [84, 4], [84, 6], [89, 6], [91, 4], [88, 8], [91, 4], [96, 4]];
    let step = 0;
    for (const [p, len] of melody) {
      notes.push([step, p, len]);
      step += len;
    }
    const res = importMidi(midiFile([{ name: 'Piano', channel: 0, program: 0, notes }]));
    const tracks = resolveTracks(res.ast);
    expect(tracks.map((t) => t.track.params.name)).toEqual(['Piano (low)', 'Piano (mid)', 'Piano (high)']);
    expect(tracks.map((t) => t.chain[0]!.type)).toEqual(['melody', 'melody', 'melody']);
    expect(res.notes.some((n) => n.message.key === 'midi.note.splitRange')).toBe(true);
    expect(await strudelNotes(res.ast, res.settings, 4)).toEqual(expectedNotes(notes, false));
  });

  it('Töne ohne passende Skala → exakter note("…")-Code mit Haltetönen', async () => {
    const notes: N[] = [
      [0, 60, 3],
      [3, 61, 1],
      [4, 62, 6],
      [10, 63, 2],
      [12, 66, 4],
      [12, 70, 4],
    ];
    const res = importMidi(midiFile([{ channel: 2, program: 0, notes }]));
    const src = sourceOf(res.ast);
    expect(src.type).toBe('code');
    expect(String(src.params.code)).toMatch(/^note\(".*c4@3.*"\)\.s\("piano"\)$/);
    expect(res.notes.some((n) => n.kind === 'keptAsCode')).toBe(true);
    expect(await strudelNotes(res.ast, res.settings, 2)).toEqual(expectedNotes([...notes, ...notes.map(([s, p, l]): N => [s + 16, p, l])], false));
  });

  it('Velocity: Mittelwert als Lautstärke, starke Streuung als velocity-Muster (Strudel-Velocity ±1)', async () => {
    const notes: N[] = [
      [0, 36, 1, 127],
      [4, 36, 1, 60],
      [8, 36, 1, 100],
      [12, 36, 1, 60],
    ];
    const res = importMidi(midiFile([{ channel: 9, notes }]));
    const chain = resolveTracks(res.ast)[0]!.chain;
    expect(chain.map((b) => b.type)).toEqual(['drums', 'code-fx']);
    expect(String(chain[1]!.params.code)).toMatch(/^\.velocity\("/);
    const got = await strudelNotes(res.ast, res.settings, 1, true);
    const want = expectedNotes(notes, true, true);
    got.forEach((g, i) => {
      const [s, p, v] = g.split(':').map(Number);
      const [ws, wp, wv] = want[i]!.split(':').map(Number);
      expect([s, p]).toEqual([ws, wp]);
      expect(Math.abs(v! - wv!)).toBeLessThanOrEqual(1);
    });
  });

  it('Drum-Muster über 2 Takte → Sample-Baustein mit <…>, exakt', async () => {
    const notes: N[] = [...beat(1), [16, 36, 1], [22, 36, 1], [26, 36, 1], [20, 39, 1], [28, 39, 1]];
    const res = importMidi(midiFile([{ channel: 9, notes }]));
    const src = sourceOf(res.ast);
    expect(src.type).toBe('sample');
    expect(String(src.params.pattern)).toContain('<');
    expect(await strudelNotes(res.ast, res.settings, 4)).toEqual(expectedNotes([...notes, ...notes.map(([s, p, l]): N => [s + 32, p, l])], true));
  });

  it('Längeres Stück mit Abschnitten → Song-Ablauf; der ganze Song klingt exakt wie die MIDI-Datei', async () => {
    // 8 Takte nur Beat, 8 Takte Beat + Bass A, 8 Takte nur Bass B, 8 Takte Beat + Bass A
    const bassA: N[] = [];
    const bassB: N[] = [];
    for (let b = 0; b < 8; b++) {
      bassA.push([b * 16, 45, 4], [b * 16 + 8, 48, 4]);
      bassB.push([b * 16, 43, 8], [b * 16 + 8, 41, 8]);
    }
    const shift = (ns: N[], bars: number) => ns.map(([s, p, l]): N => [s + bars * 16, p, l]);
    const drums = [...beat(8), ...shift(beat(8), 8), ...shift(beat(8), 24)];
    const bass = [...shift(bassA, 8), ...shift(bassB, 16), ...shift(bassA, 24)];
    const res = importMidi(
      midiFile([
        { name: 'Beat', channel: 9, notes: drums },
        { name: 'Bass', channel: 1, program: 33, notes: bass },
      ]),
    );
    const arr = res.ast.arrangement!;
    expect(arr).toBeDefined();
    expect(arr.sections.reduce((s, x) => s + x.cycles, 0)).toBe(32);
    expect(res.ast.nodes.filter(isTrackNode).map((t) => t.params.name)).toEqual(['Beat', 'Bass A', 'Bass B']);
    expect(await strudelNotes(res.ast, res.settings, 32)).toEqual([...expectedNotes(drums, true), ...expectedNotes(bass, false)].sort());
  });

  it('Hinweise: Taktart, Tempo begrenzt, nicht quantisierte Noten; Fehler bei SMPTE und ohne Noten', () => {
    const notes: N[] = [[0, 60, 4]];
    const odd = importMidi(midiFile([{ channel: 0, notes }], { bpm: 300, signature: [3, 4] }));
    expect(odd.settings.bpm).toBe(220);
    const keys = odd.notes.map((n) => n.message.key);
    expect(keys).toContain('midi.note.timeSignature');
    expect(keys).toContain('midi.note.tempoAdjusted');

    const swung = writeMidi({
      format: 0,
      ppq: 96,
      tracks: [{ events: [{ type: 'noteOn', tick: 0, channel: 0, note: 60, velocity: 90 }, { type: 'noteOff', tick: 30, channel: 0, note: 60, velocity: 0 }, { type: 'noteOn', tick: 32, channel: 0, note: 62, velocity: 90 }, { type: 'noteOff', tick: 60, channel: 0, note: 62, velocity: 0 }] }],
    });
    expect(importMidi(swung).notes.map((n) => n.message.key)).toContain('midi.note.quantized');

    const smpte = midiFile([{ channel: 0, notes }]);
    smpte[12] = 0xe7;
    smpte[13] = 0x28;
    expect(() => importMidi(smpte)).toThrow(MidiImportError);
    try {
      importMidi(smpte);
    } catch (err) {
      expect((err as MidiImportError).messageKey).toBe('midi.error.smpte');
    }
    expect(() => importMidi(midiFile([]))).toThrow(expect.objectContaining({ messageKey: 'midi.error.noNotes' }));
  });
});

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

describe('MIDI-Export', () => {
  it('Spur-Code wird zum Ausdruck (ohne setcpm und $:)', () => {
    const prog = toExpressionProgram('setcpm(120/4)\n\n// Beat\n$: s("bd*4").gain(0.8)');
    expect(prog).not.toContain('setcpm');
    expect(prog).not.toContain('$:');
    expect(prog).toContain('s("bd*4").gain(0.8)');
  });

  it('deutet Hap-Werte: Notennamen, Zahlen, freq, Synth-Standardton, Drums mit Bank/Kit, andere Samples', () => {
    expect(interpretValue({ note: 'c4', s: 'piano', gain: 1 })).toMatchObject({ pitch: 60, velocity: 127, kind: 'melodic' });
    expect(interpretValue({ note: 'Eb3', s: 'sawtooth' })).toMatchObject({ pitch: 51, velocity: 102 });
    expect(interpretValue({ note: 64.4 })).toMatchObject({ pitch: 64 });
    expect(interpretValue({ freq: 440, s: 'sine' })).toMatchObject({ pitch: 69 });
    expect(interpretValue({ s: 'sawtooth', octave: 1 })).toMatchObject({ pitch: 48 });
    expect(interpretValue({ s: 'bd', bank: 'analog', gain: 0.5, velocity: 0.5 })).toMatchObject({ pitch: 36, velocity: 32, kind: 'drums' });
    expect(interpretValue({ s: 'emu808_oh' })).toMatchObject({ pitch: 46, kind: 'drums' });
    expect(interpretValue({ s: 'tabla', n: 2 })).toMatchObject({ kind: 'percussion' });
    expect(interpretValue(3)).toBeNull();
  });

  it('Vorlagen → MIDI → Noten == Strudel-Events (jede Spur, Tonhöhe, Start, Velocity, Dauer)', async () => {
    const evaluate = await loadStrudelEvaluator();
    for (const tpl of TEMPLATES) {
      const project = templateProject(tpl.id)!;
      const bars = await suggestMidiBars(project.ast, project.settings, evaluate);
      expect(bars, tpl.id).toBeGreaterThanOrEqual(1);
      const res = await exportMidi(project.ast, project.settings, { bars, evaluate });
      const midi = parseMidi(res.bytes);
      expect(midi.ppq).toBe(480);
      expect(midi.tracks[0]!.events).toContainEqual({ type: 'tempo', tick: 0, microsecondsPerQuarter: Math.round(60_000_000 / project.settings.bpm) });
      const notes = collectNotes(midi);
      const tracks = audibleTracks(project.ast);
      expect(res.tracks.length, tpl.id).toBe(tracks.length);
      for (const [i, tr] of tracks.entries()) {
        const { query } = await evaluateStrudel(trackCode(project.ast, project.settings, tr.track.id));
        const want = new Set(
          query(0, bars).map((h) => {
            const n = interpretValue(h.value)!;
            return `${n.pitch}@${Math.round(h.begin * TICKS_PER_CYCLE)}v${n.velocity}`;
          }),
        );
        const got = new Set(notes.filter((n) => n.track === i + 1).map((n) => `${n.note}@${n.start}v${n.velocity}`));
        expect(got, `${tpl.id} / ${tr.track.params.name}`).toEqual(want);
        if (res.tracks[i]!.kind === 'melodic') {
          // Dauer: Ende wie in Strudel (am Exportende abgeschnitten)
          const ends = new Map(query(0, bars).map((h) => [`${interpretValue(h.value)!.pitch}@${Math.round(h.begin * TICKS_PER_CYCLE)}`, Math.min(bars * TICKS_PER_CYCLE, Math.round(h.end * TICKS_PER_CYCLE))]));
          for (const n of notes.filter((x) => x.track === i + 1)) expect(n.end).toBeLessThanOrEqual(ends.get(`${n.note}@${n.start}`)!);
        }
      }
    }
  });

  it('Länge: Song-Ablauf-Gesamtlänge, sonst gemeinsame Wiederholung', async () => {
    const evaluate = await loadStrudelEvaluator();
    const lofi = templateProject('lofi')!;
    expect(await suggestMidiBars(lofi.ast, lofi.settings, evaluate)).toBe(4);
    // Techno: Filter-Sweep zählt nicht, Zufall (degrade) → mindestens 8 Takte
    const techno = templateProject('techno')!;
    expect(await suggestMidiBars(techno.ast, techno.settings, evaluate)).toBe(8);
    const withSong: VisualAst = { ...lofi.ast, arrangement: { sections: [{ id: 'a', cycles: 4 }, { id: 'b', cycles: 8 }], cells: {} } };
    expect(await suggestMidiBars(withSong, lofi.settings, evaluate)).toBe(12);
  });

  it('Rundreise MIDI → Import → Export: dieselben Noten', async () => {
    const lead: N[] = [
      [0, 57, 4],
      [4, 60, 2],
      [6, 64, 2],
      [8, 62, 4],
      [12, 69, 8],
      [20, 67, 4],
      [24, 57, 8],
    ];
    const drums = beat(2);
    const original = midiFile([
      { name: 'Drums', channel: 9, notes: drums },
      { name: 'Lead', channel: 0, program: 81, notes: lead },
    ]);
    const imported = importMidi(original);
    const res = await exportMidi(imported.ast, imported.settings, { bars: 2, evaluate: await loadStrudelEvaluator() });
    expect(res.bars).toBe(2);
    expect(res.tracks.map((t) => [t.name, t.channel, t.kind])).toEqual([
      ['Drums', 10, 'drums'],
      ['Lead', 1, 'melodic'],
    ]);
    const scale = 480 / PPQ;
    const key = (n: { note: number; start: number; end: number; channel: number }) => `${n.channel}:${n.note}@${n.start}${n.channel === 9 ? '' : `-${n.end}`}`;
    const before = collectNotes(parseMidi(original)).map((n) => key({ ...n, start: n.start * scale, end: n.end * scale }));
    const after = collectNotes(parseMidi(res.bytes)).map(key);
    expect(after.sort()).toEqual(before.sort());
    const program = parseMidi(res.bytes).tracks[2]!.events.find((e) => e.type === 'programChange');
    expect(program).toMatchObject({ program: 81 });
  });

  it('Rundreise Vorlage → MIDI → Import → Strudel: dieselben Noten (alle Vorlagen)', async () => {
    const evaluate = await loadStrudelEvaluator();
    for (const tpl of TEMPLATES) {
      const project = templateProject(tpl.id)!;
      const ex = await exportMidi(project.ast, project.settings, { evaluate });
      const imported = importMidi(ex.bytes);
      expect(imported.settings.bpm).toBe(project.settings.bpm);
      expect(imported.stats.codeBlocks, tpl.id).toBe(0);
      const { query } = await evaluateStrudel(compile(imported.ast, imported.settings).code);
      const got = new Set(
        query(0, ex.bars).map((h) => {
          const n = interpretValue(h.value)!;
          return `${n.kind === 'melodic' ? 'm' : 'd'}${n.pitch}@${Math.round(h.begin * TICKS_PER_CYCLE)}`;
        }),
      );
      const want = new Set(collectNotes(parseMidi(ex.bytes)).map((n) => `${n.channel === 9 ? 'd' : 'm'}${n.note}@${n.start}`));
      expect(got, tpl.id).toEqual(want);
    }
  });

  it('Stumme Spuren und kaputter Code werden mit Hinweis übersprungen', async () => {
    const project = templateProject('techno')!;
    const ast = structuredClone(project.ast);
    const tracks = ast.nodes.filter(isTrackNode);
    tracks[0]!.params.muted = true;
    const res = await exportMidi(ast, project.settings, { bars: 1, evaluate: await loadStrudelEvaluator() });
    expect(res.tracks).toHaveLength(2);
    const broken = { ...project.ast, nodes: project.ast.nodes.map((n) => (n.type === 'chords' ? { ...n, type: 'code' as const, params: { code: 'nope_unknown_fn()' } } : n)) };
    const res2 = await exportMidi(broken, project.settings, { bars: 1, evaluate: await loadStrudelEvaluator() });
    expect(res2.notes.map((n) => n.key)).toContain('midi.export.trackFailed');
  });
});


/* ------------------------------------------------------------------ */
/* WebMCP                                                              */
/* ------------------------------------------------------------------ */

describe('WebMCP: export_midi / import_midi', () => {
  const run = async (name: string, input: Record<string, unknown> = {}) =>
    (await TOOLS.find((t) => t.name === name)!.execute(input, { signal: new AbortController().signal })) as Record<string, unknown>;

  it('exportiert das Projekt als Base64-MIDI und importiert es wieder (ersetzen/anhängen)', async () => {
    clearProject();
    const tpl = templateProject('synthwave')!;
    loadProject(tpl.ast, tpl.settings);
    const exported = await run('export_midi', { bars: 4 });
    expect(exported.ok).toBe(true);
    expect(exported.bars).toBe(4);
    expect(exported.bpm).toBe(100);
    const bytes = Uint8Array.from(atob(String(exported.base64)), (c) => c.charCodeAt(0));
    expect(parseMidi(bytes).tracks).toHaveLength(1 + (exported.tracks as unknown[]).length);

    const imported = await run('import_midi', { data: exported.base64 });
    expect(imported.ok).toBe(true);
    expect(projectSettings.get().bpm).toBe(100);
    const names = resolveTracks(visualAstStore.get()).map((t) => t.track.params.name);
    expect(names).toEqual(tpl.ast.nodes.filter(isTrackNode).map((t) => t.params.name));
    await run('import_midi', { data: `data:audio/midi;base64,${String(exported.base64)}`, mode: 'append' });
    expect(resolveTracks(visualAstStore.get())).toHaveLength(8);

    await expect(run('import_midi', { data: toBase64(new TextEncoder().encode('not midi')) })).rejects.toThrow(/Could not import/);
    await expect(run('export_midi', { bars: 0 })).rejects.toThrow(/bars/);
  });
});
