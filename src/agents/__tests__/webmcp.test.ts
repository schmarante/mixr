import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compile } from '../CompilerAgent';
import { TOOLS, ToolInputError, coerceParams, parseDrumPattern, parseNoteSteps, startWebMcpAgent, stopWebMcpAgent, type ModelContextTool } from '../WebMcpAgent';
import { projectSettings, transportCommand, visualAstStore } from '../../store/agentBus';
import { clearProject } from '../../store/actions';
import { languageStore } from '../../i18n';
import { evaluateStrudel } from './strudelHarness';

const signal = new AbortController().signal;

function tool(name: string): ModelContextTool {
  const found = TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`tool ${name} missing`);
  return found;
}

async function run(name: string, input: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return (await tool(name).execute(input, { signal })) as Record<string, unknown>;
}

interface Snapshot {
  bpm: number;
  tracks: { id: string; name: string; blocks: { id: string; type: string; params: Record<string, unknown> }[] }[];
  strudelCode: string;
}

const snapshot = async () => (await run('get_project')) as unknown as Snapshot;
const code = () => compile(visualAstStore.get(), projectSettings.get()).code;

beforeEach(() => {
  languageStore.set('en');
  clearProject();
  projectSettings.set({ bpm: 120 });
});

describe('WebMCP-Werkzeuge', () => {
  it('haben gültige, eindeutige Namen und Beschreibungen (Spec: 1–128 Zeichen [A-Za-z0-9_.-])', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.inputSchema?.type).toBe('object');
    }
  });

  it('baut einen Beat mit Melodie, der durch echtes Strudel läuft', async () => {
    const drums = await run('add_track', { source: 'drums', name: 'Beat' });
    expect(drums.ok).toBe(true);
    await run('set_drum_pattern', {
      blockId: drums.sourceBlockId,
      pattern: { bd: 'x---x---x---x---', sd: '----x-------x---', hh: '--x---x---x---x-' },
    });
    await run('add_block', { trackId: drums.trackId, type: 'room', params: { amount: 0.3 } });

    const melody = await run('add_track', { source: 'melody' });
    await run('update_block', { blockId: melody.sourceBlockId, params: { root: 'A', scale: 'minor:pentatonic', sound: 'square' } });
    await run('set_notes', { blockId: melody.sourceBlockId, steps: [0, null, 2, null, [0, 2, 4], null, 4, null, 0, null, 3, null, 2, null, 1, null] });
    await run('set_tempo', { bpm: 128 });

    const snap = await snapshot();
    expect(snap.bpm).toBe(128);
    expect(snap.tracks).toHaveLength(2);
    expect(snap.tracks[0]!.blocks[0]!.params.grid).toMatchObject({ bd: 'x---x---x---x---', sd: '----x-------x---' });
    expect(snap.tracks[1]!.blocks[0]!.params.grid).toEqual([0, null, 2, null, [0, 2, 4], null, 4, null, 0, null, 3, null, 2, null, 1, null]);

    const c = code();
    expect(c).toContain('setcpm(128/4)');
    expect(c).toContain('.room(0.3)');
    expect(c).toContain('.scale("A3:minor:pentatonic")');
    const { query } = await evaluateStrudel(c);
    expect(query(0, 1).length).toBeGreaterThan(10);
  });

  it('klemmt Zahlen, lehnt unbekannte Werte verständlich ab', () => {
    expect(coerceParams('lpf', { cutoff: 999999 })).toEqual({ cutoff: 12000 });
    expect(() => coerceParams('lpf', { nope: 1 })).toThrow(/has no parameter "nope"/);
    expect(() => coerceParams('drums', { bank: 'RolandTR909' })).toThrow(/must be one of: modern, analog, emu808/);
    expect(() => parseDrumPattern({ bd: 'x---' }, ['bd'])).toThrow(/exactly 16 steps/);
    expect(() => parseDrumPattern({ kick: 'x---x---x---x---' }, ['bd'])).toThrow(/Unknown instrument "kick"/);
    expect(() => parseNoteSteps([0, 1], 8)).toThrow(/exactly 16 entries/);
    expect(() => parseNoteSteps(Array(16).fill(9), 8)).toThrow(/0 to 7/);
  });

  it('meldet unbekannte IDs und Typen als ToolInputError', async () => {
    await expect(run('remove_block', { blockId: 'block-nope' })).rejects.toBeInstanceOf(ToolInputError);
    await expect(run('add_track', { source: 'lpf' })).rejects.toThrow(/not a sound source/);
    await expect(run('add_block', { trackId: 'x', type: 'warp' })).rejects.toThrow(/No track with id/);
  });

  it('lädt Vorlagen, spielt auf Wunsch ab und lässt sich rückgängig machen', async () => {
    const templates = (await run('list_templates')) as unknown as { id: string; name: string }[];
    expect(templates.length).toBeGreaterThan(0);
    expect(templates[0]!.name).not.toBe(templates[0]!.id);

    const res = await run('load_template', { id: templates[0]!.id, play: true });
    expect(res.ok).toBe(true);
    expect(transportCommand.get()?.action).toBe('play');
    expect((await snapshot()).tracks.length).toBeGreaterThan(0);

    await run('undo');
    expect((await snapshot()).tracks).toHaveLength(0);
    await run('redo');
    expect((await snapshot()).tracks.length).toBeGreaterThan(0);
  });

  it('import_strudel_code baut aus REPL-Code ein Projekt (ersetzen und anhängen)', async () => {
    const code = 'setcpm(30)\n// Beat\n$: s("bd*4, ~ sd").bank("RolandTR909").room(0.2)._pianoroll()\n$: n("0 2 4 7").scale("C3:minor").s("gm_acoustic_bass")';
    const res = await run('import_strudel_code', { code });
    expect(res.ok).toBe(true);
    const snap = await snapshot();
    expect(snap.bpm).toBe(120);
    expect(snap.tracks.map((t) => t.blocks[0]!.type)).toEqual(['drums', 'melody']);
    expect((res.notes as { kind: string }[]).some((n) => n.kind === 'substituted')).toBe(true);
    await run('import_strudel_code', { code, mode: 'append' });
    expect((await snapshot()).tracks).toHaveLength(4);
    await expect(run('import_strudel_code', { code: '$: s("bd' })).rejects.toThrow(/Could not import/);
  });

  it('set_notes: Haltetöne und mehrere Takte, klingen in Strudel exakt so lang', async () => {
    const t = await run('add_track', { source: 'melody' });
    const steps: unknown[] = Array(32).fill(null);
    steps[0] = { notes: 0, length: 8 };
    steps[12] = { notes: [2, 4], length: 6 }; // hält über die Taktgrenze
    await run('set_notes', { blockId: t.sourceBlockId, bars: 2, steps });
    const snap = await snapshot();
    expect(snap.tracks[0]!.blocks[0]!.params.grid).toMatchObject({ bars: 2 });
    const c = code();
    expect(c).toContain('.slow(2)');
    const { query } = await evaluateStrudel(c);
    expect(query(0, 2).map((h) => [h.begin, h.end])).toEqual([
      [0, 0.5],
      [0.75, 1.125],
      [0.75, 1.125],
    ]);
    await expect(run('set_notes', { blockId: t.sourceBlockId, bars: 2, steps: Array(16).fill(null) })).rejects.toThrow(/exactly 32 entries/);
  });

  it('Arrangement: Abschnitte anlegen, Spuren schalten, Variante, Schleife – Code passt', async () => {
    const kick = await run('add_track', { source: 'drums', name: 'Kick' });
    const pad = await run('add_track', { source: 'chords', name: 'Pad' });
    const res = await run('create_arrangement', { sections: [{ cycles: 4, name: 'Intro' }, { cycles: 8, name: 'Drop' }] });
    const [intro, drop] = res.sectionIds as string[];
    await run('set_section_cell', { trackId: kick.trackId, sectionId: intro, on: false });
    await run('set_section_cell', { trackId: pad.trackId, sectionId: drop, on: true, code: '.lpf(800)' });
    const snap = (await run('get_project')) as unknown as { arrangement: { totalCycles: number; sections: { name: string }[] } };
    expect(snap.arrangement.totalCycles).toBe(12);
    expect(snap.arrangement.sections.map((x) => x.name)).toEqual(['Intro', 'Drop']);
    expect(code()).toContain('$: arrange([4, silence], [8, kickPart])');
    expect(code()).toContain('[8, padPart.lpf(800)]');
    await run('loop_section', { sectionId: drop });
    expect(code()).toContain('$: arrange([8, kickPart])');
    await run('loop_section', { sectionId: null });
    await expect(run('set_section_cell', { trackId: kick.trackId, sectionId: 'nope', on: true })).rejects.toThrow(/No section/);
    const { query } = await evaluateStrudel(code());
    expect(query(0, 1).every((h) => h.value.s !== 'bd')).toBe(true); // Intro ohne Kick
    expect(query(4, 5).some((h) => h.value.s === 'bd')).toBe(true); // Drop mit Kick
  });

  it('list_block_types beschreibt alle Bausteine mit Parametern', async () => {
    const types = (await run('list_block_types')) as unknown as { type: string; kind: string; label: string; params: { key: string }[] }[];
    const drums = types.find((t) => t.type === 'drums');
    expect(drums?.kind).toBe('source');
    expect(drums?.label).toBe('Drums');
    expect(drums?.params.map((p) => p.key)).toEqual(['grid', 'bank']);
  });
});

describe('Registrierung bei document.modelContext', () => {
  afterEach(() => {
    stopWebMcpAgent();
    vi.unstubAllGlobals();
  });

  it('ist ohne Browser-Unterstützung ein No-op', () => {
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('document', {});
    expect(() => startWebMcpAgent()).not.toThrow();
  });

  it('registriert alle Werkzeuge einmal und meldet sie per AbortSignal ab', () => {
    const registerTool = vi.fn<(t: ModelContextTool, o: { signal: AbortSignal }) => Promise<void>>(async () => {});
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('document', { modelContext: { registerTool } });
    startWebMcpAgent();
    startWebMcpAgent(); // idempotent
    expect(registerTool).toHaveBeenCalledTimes(TOOLS.length);
    const { signal: regSignal } = registerTool.mock.calls[0]![1];
    expect(regSignal.aborted).toBe(false);
    stopWebMcpAgent();
    expect(regSignal.aborted).toBe(true);
  });

  it('gibt Eingabefehler als lesbare Antwort zurück statt zu werfen', async () => {
    const registerTool = vi.fn<(t: ModelContextTool, o: { signal: AbortSignal }) => Promise<void>>(async () => {});
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('document', { modelContext: { registerTool } });
    startWebMcpAgent();
    const registered = registerTool.mock.calls.map((c) => c[0]).find((t) => t.name === 'remove_track')!;
    await expect(registered.execute({ trackId: 'nope' }, { signal })).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/No track with id "nope"/),
    });
  });
});
