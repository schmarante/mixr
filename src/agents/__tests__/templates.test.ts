import { describe, expect, it } from 'vitest';
import { BLOCK_CATALOG, TRACK_COLORS } from '../../blocks/catalog';
import { TEMPLATES } from '../../data/templates';
import { resolveTracks } from '../../store/selectors';
import { isTrackNode, type BlockNode, type VisualAst } from '../../types/ast';
import { compile } from '../CompilerAgent';
import { core, evaluateStrudel, transpile } from './strudelHarness';

function soloTrack(ast: VisualAst, trackId: string): VisualAst {
  return {
    ...ast,
    nodes: ast.nodes.map((n) => (isTrackNode(n) ? { ...n, params: { ...n.params, solo: n.id === trackId } } : n)),
  };
}

describe('Vorlagen', () => {
  it('4–5 Vorlagen mit eindeutigen IDs', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(4);
    expect(TEMPLATES.length).toBeLessThanOrEqual(5);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });

  describe.each(TEMPLATES.map((t) => [t.id, t] as const))('%s', (_name, tpl) => {
    const tracks = resolveTracks(tpl.ast);

    it('Struktur: 2–4 Spuren, Quelle vorne, deterministische IDs, Kanten wie actions.ts', () => {
      expect(tracks.length).toBeGreaterThanOrEqual(2);
      expect(tracks.length).toBeLessThanOrEqual(4);
      const ids = tpl.ast.nodes.map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const e of tpl.ast.edges) expect(e.id).toBe(`e-${e.source}-${e.target}`);
      // jeder Block hängt in genau einer Kette
      const blocks = tpl.ast.nodes.filter((n): n is BlockNode => !isTrackNode(n));
      expect(tracks.flatMap((t) => t.chain).length).toBe(blocks.length);
      for (const t of tracks) {
        expect(BLOCK_CATALOG[t.chain[0]!.type].kind).toBe('source');
        expect(t.chain.slice(1).every((b) => BLOCK_CATALOG[b.type].kind !== 'source')).toBe(true);
        expect(TRACK_COLORS).toContain(t.track.params.color);
      }
    });

    it('Parameter entsprechen dem Katalog', () => {
      for (const block of tpl.ast.nodes.filter((n): n is BlockNode => !isTrackNode(n))) {
        const def = BLOCK_CATALOG[block.type];
        expect(Object.keys(block.params).sort()).toEqual(def.params.map((p) => p.key).sort());
        for (const p of def.params) {
          const v = block.params[p.key];
          if (p.type === 'number') {
            expect(typeof v).toBe('number');
            expect(v as number).toBeGreaterThanOrEqual(p.min);
            expect(v as number).toBeLessThanOrEqual(p.max);
          }
          if (p.type === 'select' && p.key !== 'progression') {
            expect(p.options.map((o) => o.value), `${block.id}.${p.key}`).toContain(v);
          }
        }
      }
    });

    it('kompiliert ohne Diagnosen und transpiliert', () => {
      const r = compile(tpl.ast, tpl.settings);
      expect(r.diagnostics).toEqual([]);
      expect(r.code.startsWith(`setcpm(${tpl.settings.bpm}/4)`)).toBe(true);
      expect(() => transpile(r.code)).not.toThrow();
    });

    it('jede Spur erzeugt in Strudel Events', async () => {
      for (const t of tracks) {
        const { code } = compile(soloTrack(tpl.ast, t.track.id), tpl.settings);
        const { query, cps } = await evaluateStrudel(code);
        expect(cps).toBeCloseTo(tpl.settings.bpm / 4 / 60);
        const haps = query(0, 4);
        expect(haps.length, t.track.params.name).toBeGreaterThan(0);
        for (const h of haps) {
          expect(h.value.gain).toBe(t.track.params.volume);
          if ('note' in h.value) expect(String(h.value.note)).toMatch(/^[A-Ga-g][#b]*\d$/);
        }
      }
    });
  });
});

describe('Lo-Fi Hip-Hop: Melodie passt zu den Akkorden', () => {
  const tpl = TEMPLATES.find((t) => t.id === 'lofi')!;
  const tracks = resolveTracks(tpl.ast);
  const byKey = (source: string) => tracks.find((t) => t.chain[0]!.type === source)!;

  async function notesOf(trackId: string, cycles: number) {
    const { code } = compile(soloTrack(tpl.ast, trackId), tpl.settings);
    const { query } = await evaluateStrudel(code);
    return query(0, cycles)
      .filter((h) => h.value.note !== undefined)
      .map((h) => ({ begin: h.begin, end: h.end, midi: core.noteToMidi(String(h.value.note)) as number }));
  }

  // <Am7 Dm7 Em7 Am7> – Akkordtöne als Tonklassen (C = 0)
  const CHORD_TONES = [
    [9, 0, 4, 7], // Am7: A C E G
    [2, 5, 9, 0], // Dm7: D F A C
    [4, 7, 11, 2], // Em7: E G B D
    [9, 0, 4, 7], // Am7
  ];

  it('jeder Melodieton ist Akkordton und reibt sich nie im Halbton mit dem Klavier (8 Takte)', async () => {
    const chords = await notesOf(byKey('chords').track.id, 8);
    const melody = await notesOf(byKey('melody').track.id, 8);
    expect(melody.length).toBeGreaterThanOrEqual(16);
    for (const m of melody) {
      const bar = Math.floor(m.begin);
      expect(CHORD_TONES[bar % 4], `Ton ${m.midi} in Takt ${bar + 1}`).toContain(m.midi % 12);
      const sounding = chords.filter((c) => c.begin <= m.begin && c.end > m.begin);
      expect(sounding.length).toBeGreaterThan(0);
      for (const c of sounding) {
        const interval = (((m.midi - c.midi) % 12) + 12) % 12;
        expect([1, 11], `Halbton-Reibung ${m.midi}/${c.midi} in Takt ${bar + 1}`).not.toContain(interval);
      }
    }
  });
});
