import { beforeEach, describe, expect, it } from 'vitest';
import { compile } from '../../agents/CompilerAgent';
import { importStrudelCode } from '../../agents/importer';
import { templateProject } from '../../data/templates';
import { languageStore } from '../../i18n';
import type { BlockNode, ProjectSettings, UserSampleSlot, VisualAst } from '../../types/ast';
import { historyState, loadProject, selectNode, syncProjectFromCode, undo, endEditSeries, setLoopSection } from '../actions';
import { projectSettings, uiState, visualAstStore } from '../agentBus';
import { compiledSectionOrder } from '../codeSync';
import { resolveTracks } from '../selectors';

beforeEach(() => languageStore.set('en'));

const SLOTS: UserSampleSlot[] = [{ id: 'slot-1', name: 'vox', files: [{ id: 'f1', fileName: 'vox.wav', mime: 'audio/wav', size: 4 }] }];

function load(id: string, extra: Partial<ProjectSettings> = {}, mutate?: (ast: VisualAst) => void) {
  const p = templateProject(id)!;
  const ast = structuredClone(p.ast);
  mutate?.(ast);
  loadProject(ast, { ...p.settings, samples: SLOTS, ...extra });
}

function code(): string {
  return compile(visualAstStore.get(), projectSettings.get()).code;
}

/** Ersetzt genau einmal vorkommenden Text im aktuellen Code und synchronisiert. */
function edit(from: string, to: string, series = 's1') {
  const c = code();
  expect(c.split(from).length - 1, `„${from}“ genau einmal im Code`).toBe(1);
  return syncProjectFromCode(importStrudelCode(c.replace(from, to)), { series });
}

function tracks() {
  return resolveTracks(visualAstStore.get());
}

function ids(): string[] {
  return visualAstStore.get().nodes.map((n) => n.id).sort();
}

describe('syncProjectFromCode – ID-Erhalt', () => {
  it('Drum-Pattern im Code ändern: gleiche IDs, Raster folgt, Rest unverändert', () => {
    load('techno');
    const before = structuredClone(visualAstStore.get());
    const idsBefore = ids();
    expect(edit('"bd*4, ', '"bd*8, ')).toBe('changed');
    expect(ids()).toEqual(idsBefore);
    const beat = tracks()[0]!;
    const grid = beat.chain[0]!.params['grid'] as { rows: Record<string, boolean[]> };
    expect(grid.rows['bd']!.filter(Boolean)).toHaveLength(8);
    // Andere Spuren: exakt dieselben Knoten (auch Parameter, die der Code nicht zeigt)
    const otherBefore = resolveTracks(before).slice(1);
    expect(tracks().slice(1)).toEqual(otherBefore);
    // Spurfarben, Namen bleiben
    expect(tracks().map((t) => t.track.params.color)).toEqual(resolveTracks(before).map((t) => t.track.params.color));
    // Sample-Slots bleiben
    expect(projectSettings.get().samples).toEqual(SLOTS);
    expect(code()).toContain('s("bd*8, ');
  });

  it('Effektwert ändern → nur dieser Baustein, ID bleibt', () => {
    load('techno');
    const lpf = tracks()[2]!.chain.find((b) => b.type === 'lpf')!;
    expect(edit('.lpf(1600)', '.lpf(900)')).toBe('changed');
    const after = tracks()[2]!.chain.find((b) => b.type === 'lpf')!;
    expect(after.id).toBe(lpf.id);
    expect(after.params['cutoff']).toBe(900);
  });

  it('Neuen Effekt einfügen → neuer Baustein an der passenden Stelle, übrige IDs bleiben', () => {
    load('techno');
    const chainBefore = tracks()[0]!.chain.map((b) => b.id);
    expect(edit('.hpf(40)', '.hpf(40).room(0.5)')).toBe('changed');
    const chain = tracks()[0]!.chain;
    expect(chain.map((b) => b.type)).toEqual(['drums', 'hpf', 'room']);
    expect(chain.slice(0, 2).map((b) => b.id)).toEqual(chainBefore);
  });

  it('Nur Kommentar/Leerzeichen → keine Änderung, kein Undo-Schritt', () => {
    load('techno');
    const undoBefore = historyState.get().canUndo;
    const result = syncProjectFromCode(importStrudelCode(`${code()}\n\n// nur ein Kommentar\n`), { series: 'x' });
    expect(result).toBe('unchanged');
    expect(historyState.get().canUndo).toBe(undoBefore);
  });

  it('Spur im Code löschen und neue Spur tippen; stumme Spur bleibt erhalten', () => {
    load('techno', {}, (ast) => {
      const bass = ast.nodes.find((n) => n.type === 'track' && n.params.name === 'Acid bass')!;
      if (bass.type === 'track') bass.params.muted = true; // steht nicht im Code
    });
    const mutedId = tracks()[1]!.track.id;
    const c = code().replace(/\/\/ Stabs\n\$: [^\n]+/, '// Hats\n$: s("hh*16").gain(0.5)');
    expect(syncProjectFromCode(importStrudelCode(c), { series: 'y' })).toBe('changed');
    const names = tracks().map((t) => t.track.params.name);
    expect(names).toEqual(['Beat', 'Acid bass', 'Hats']);
    expect(tracks()[1]!.track.id).toBe(mutedId);
    expect(tracks()[1]!.track.params.muted).toBe(true);
    expect(tracks()[2]!.track.params.color).not.toBe(tracks()[0]!.track.params.color);
  });

  it('Überbrückter Baustein bleibt beim Bearbeiten der Spur erhalten', () => {
    load('techno', {}, (ast) => {
      const hpf = ast.nodes.find((n) => n.type === 'hpf') as BlockNode;
      hpf.bypassed = true;
    });
    expect(code()).not.toContain('.hpf(40)');
    expect(edit('.bank("modern")', '.bank("modern").crush(6)')).toBe('changed');
    const chain = tracks()[0]!.chain;
    // Neuer Baustein direkt hinter seinem Vorgänger im Code, der überbrückte bleibt dahinter
    expect(chain.map((b) => [b.type, b.bypassed ?? false])).toEqual([
      ['drums', false],
      ['crush', false],
      ['hpf', true],
    ]);
  });

  it('Automatische Orbits und Code-Quellen erzeugen keine zusätzlichen Bausteine', () => {
    load('lofi');
    const chordsBefore = tracks()[1]!.chain.map((b) => b.type);
    expect(edit('.lpf(1800)', '.lpf(1200)')).toBe('changed');
    expect(tracks()[1]!.chain.map((b) => b.type)).toEqual(chordsBefore);
    // House-Bass als Code-Quelle (die Vorlage selbst nutzt inzwischen einen Melodie-Block)
    load('house', {}, (ast) => {
      const i = ast.nodes.findIndex((n) => n.id === 'house-t3-b1');
      ast.nodes[i] = {
        id: 'house-t3-b1',
        type: 'code',
        params: { code: 'note("<a1 d2 e2 a1>").struct("[~ x ~ x]*4").s("sawtooth")' },
      } as BlockNode;
    });
    const bass = tracks()[2]!;
    expect(bass.chain[0]!.type).toBe('code');
    expect(edit('.lpf(600)', '.lpf(700)')).toBe('changed');
    expect(tracks()[2]!.chain[0]).toEqual(bass.chain[0]);
    expect(tracks()[2]!.chain.map((b) => b.id)).toEqual(bass.chain.map((b) => b.id));
  });

  it('Auswahl bleibt, wenn der ausgewählte Baustein bestehen bleibt', () => {
    load('techno');
    const lpf = tracks()[2]!.chain.find((b) => b.type === 'lpf')!;
    selectNode(lpf.id);
    edit('.lpf(1600)', '.lpf(1000)');
    expect(uiState.get().selectedNodeId).toBe(lpf.id);
  });

  it('Leeres Projekt + Code tippen → erste Spuren entstehen, Tempo bleibt ohne setcpm', () => {
    loadProject({ nodes: [], edges: [] }, { bpm: 97 });
    expect(syncProjectFromCode(importStrudelCode('$: s("bd*4")'), { series: 'e', hasTempo: false })).toBe('changed');
    expect(tracks()).toHaveLength(1);
    expect(tracks()[0]!.chain[0]!.type).toBe('drums');
    expect(projectSettings.get().bpm).toBe(97);
  });
});

describe('syncProjectFromCode – Undo', () => {
  it('eine Tipp-Serie = ein Undo-Schritt, danach wieder getrennt', () => {
    load('techno');
    const original = structuredClone(visualAstStore.get());
    edit('.lpf(1600)', '.lpf(1500)', 'series-a');
    edit('.lpf(1500)', '.lpf(1400)', 'series-a');
    edit('.lpf(1400)', '.lpf(1300)', 'series-a');
    undo();
    expect(visualAstStore.get()).toEqual(original);

    edit('.lpf(1600)', '.lpf(1500)', 'series-b');
    endEditSeries('series-b');
    edit('.lpf(1500)', '.lpf(1400)', 'series-b');
    undo();
    expect(code()).toContain('.lpf(1500)');
    undo();
    expect(visualAstStore.get()).toEqual(original);
  });
});

describe('syncProjectFromCode – Song-Ablauf', () => {
  function withArrangement(ast: VisualAst) {
    const [beat, bass] = ast.nodes.filter((n) => n.type === 'track');
    ast.arrangement = {
      sections: [
        { id: 'sec-intro', cycles: 4, name: 'Intro' },
        { id: 'sec-break', cycles: 4, name: 'Break' },
        { id: 'sec-drop', cycles: 8, name: 'Drop' },
      ],
      cells: {
        [beat!.id]: { 'sec-intro': { on: true }, 'sec-break': { on: false }, 'sec-drop': { on: true, code: '.lpf(800)' } },
        [bass!.id]: { 'sec-intro': { on: false }, 'sec-break': { on: false }, 'sec-drop': { on: true } },
      },
      loopSection: null,
    };
  }

  it('Import des eigenen Codes ergibt denselben Song-Ablauf (zusammengefasste Pausen)', () => {
    load('techno', {}, withArrangement);
    const c = code();
    expect(c).toContain('[8, silence]'); // Intro + Break der Bass-Spur
    const r = importStrudelCode(c);
    expect(r.ast.arrangement?.sections.map((s) => s.cycles)).toEqual([4, 4, 8]);
    const arrangeLines = (text: string) => text.split('\n').filter((l) => l.includes('arrange('));
    expect(arrangeLines(compile(r.ast, r.settings).code)).toEqual(arrangeLines(c));
  });

  it('Abwandlung im Code ändern → Zelle folgt, Abschnitte (IDs, Namen) bleiben', () => {
    load('techno', {}, withArrangement);
    const sectionsBefore = structuredClone(visualAstStore.get().arrangement!.sections);
    expect(edit('beatPart.lpf(800)', 'beatPart.lpf(500)')).toBe('changed');
    const arr = visualAstStore.get().arrangement!;
    expect(arr.sections).toEqual(sectionsBefore);
    const beatId = tracks()[0]!.track.id;
    expect(arr.cells[beatId]!['sec-drop']).toEqual({ on: true, code: '.lpf(500)' });
    // Effekt der Spur selbst im Code ändern → Baustein, Ablauf unverändert
    expect(edit('.hpf(40)', '.hpf(60)')).toBe('changed');
    expect(visualAstStore.get().arrangement).toEqual(arr);
  });

  it('Spur im zusammengefassten Pausen-Abschnitt einschalten → beide Projekt-Abschnitte', () => {
    load('techno', {}, withArrangement);
    expect(edit('arrange([8, silence], [8, acidBassPart])', 'arrange([4, acidBassPart], [4, silence], [8, acidBassPart])')).toBe('changed');
    const bassId = tracks()[1]!.track.id;
    expect(visualAstStore.get().arrangement!.cells[bassId]).toEqual({ 'sec-intro': { on: true }, 'sec-break': { on: false }, 'sec-drop': { on: true } });
  });

  it('Code ohne arrange → Ablauf bleibt, die Spur spielt durchgehend', () => {
    load('techno', {}, withArrangement);
    const c = code()
      .replace(/const beatPart = ([^\n]+)\n\$: arrange\([^\n]+\)\.gain\(0\.9\)/, '$: $1.gain(0.9)');
    expect(c).not.toContain('beatPart');
    expect(syncProjectFromCode(importStrudelCode(c), { series: 'z' })).toBe('changed');
    const arr = visualAstStore.get().arrangement!;
    expect(arr.sections.map((s) => s.name)).toEqual(['Intro', 'Break', 'Drop']);
    expect(arr.cells[tracks()[0]!.track.id]).toBeUndefined();
    expect(arr.cells[tracks()[1]!.track.id]).toBeDefined();
  });

  it('Schleife: Code zeigt nur einen Abschnitt – Änderungen landen dort, Aufbau-Änderung wird nicht übernommen', () => {
    load('techno', {}, withArrangement);
    setLoopSection('sec-drop');
    expect(compiledSectionOrder(visualAstStore.get().arrangement).map((s) => s.id)).toEqual(['sec-drop']);
    expect(edit('beatPart.lpf(800)', 'beatPart.lpf(300)')).toBe('changed');
    expect(visualAstStore.get().arrangement!.cells[tracks()[0]!.track.id]!['sec-drop']).toEqual({ on: true, code: '.lpf(300)' });
    expect(visualAstStore.get().arrangement!.sections).toHaveLength(3);
    // Zusätzlicher Abschnitt im Schleifen-Code → nicht darstellbar (übrige Abschnitte gingen verloren)
    const c = code().replace(/arrange\(\[8, ([^\]]+)\]\)/g, 'arrange([8, $1], [4, silence])');
    expect(syncProjectFromCode(importStrudelCode(c), { series: 'w' })).toBe('unrepresentable');
  });

  it('Uneinheitliche Abschnitte je Spur → nicht darstellbar, Bausteine bleiben', () => {
    load('techno', {}, withArrangement);
    const before = structuredClone(visualAstStore.get());
    const c = code().replace('arrange([4, beatPart]', 'arrange([2, beatPart]');
    expect(syncProjectFromCode(importStrudelCode(c), { series: 'v' })).toBe('unrepresentable');
    expect(visualAstStore.get()).toEqual(before);
  });
});
