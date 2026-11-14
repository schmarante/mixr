import { DRUM_INSTRUMENTS, defaultParams } from '../blocks/catalog';
import { templateTrackName } from '../blocks/text';
import { translateDynamic } from '../i18n';
import type {
  BlockNode,
  BlockType,
  DrumGridValue,
  NoteGridValue,
  ParamValues,
  ProjectSettings,
  TrackColor,
  TrackNode,
  VisualAst,
  VisualEdge,
} from '../types/ast';

/**
 * Vorlage. Name, Beschreibung und Spurnamen stehen in src/i18n/<sprache>/templates.json
 * (templates.<id>.name|description|tracks.<spur>); Zugriff über src/blocks/text.ts.
 * Der AST trägt die englischen Spurnamen (deterministisch für Tests);
 * `templateProject()` setzt beim Laden die Namen der aktuellen Sprache ein.
 */
export interface ProjectTemplate {
  id: string;
  icon: string;
  /** Text-Keys der Spuren, in Reihenfolge (Spur-ID `<id>-t<i>` ↔ trackKeys[i-1]). */
  trackKeys: string[];
  settings: ProjectSettings;
  ast: VisualAst;
}

/* ------------------------------------------------------------------ */
/* Reine Bau-Helfer (committen NICHT in den Store)                     */
/* ------------------------------------------------------------------ */

interface BlockSpec {
  type: BlockType;
  /** Überschreibt einzelne Katalog-Defaults. */
  params?: ParamValues;
  bypassed?: boolean;
}

interface TrackSpec {
  /** Text-Key des Spurnamens (templates.<id>.tracks.<key>). */
  key: string;
  color: TrackColor;
  volume: number;
  blocks: BlockSpec[];
}

/**
 * Baut einen AST mit deterministischen IDs:
 * Spur `<tpl>-t<i>`, Block `<tpl>-t<i>-b<j>`, Kanten wie in actions.ts
 * (track → block1 → block2 …, ID `e-<source>-<target>`).
 */
function buildAst(templateId: string, tracks: TrackSpec[]): Pick<ProjectTemplate, 'ast' | 'trackKeys'> {
  const nodes: VisualAst['nodes'] = [];
  const edges: VisualEdge[] = [];
  tracks.forEach((spec, i) => {
    const name = translateDynamic('en', `templates.${templateId}.tracks.${spec.key}`) ?? spec.key;
    const track: TrackNode = {
      id: `${templateId}-t${i + 1}`,
      type: 'track',
      params: { name, color: spec.color, volume: spec.volume, muted: false, solo: false },
    };
    const blocks: BlockNode[] = spec.blocks.map((b, j) => ({
      id: `${track.id}-b${j + 1}`,
      type: b.type,
      params: { ...defaultParams(b.type), ...b.params },
      ...(b.bypassed ? { bypassed: true } : {}),
    }));
    nodes.push(track, ...blocks);
    const ids = [track.id, ...blocks.map((b) => b.id)];
    for (let k = 0; k < ids.length - 1; k++) {
      edges.push({ id: `e-${ids[k]}-${ids[k + 1]}`, source: ids[k]!, target: ids[k + 1]! });
    }
  });
  return { ast: { nodes, edges }, trackKeys: tracks.map((t) => t.key) };
}

/**
 * Drum-Raster aus lesbaren Strings: "x" = Schlag, alles andere = Pause.
 * Nicht genannte Instrumente bleiben leer (alle Katalog-Zeilen sind vorhanden).
 */
function drums(rows: Partial<Record<string, string>>, steps = 16): DrumGridValue {
  const out: Record<string, boolean[]> = {};
  for (const { value } of DRUM_INSTRUMENTS) {
    const line = rows[value] ?? '';
    out[value] = Array.from({ length: steps }, (_, i) => line[i] === 'x');
  }
  return { steps, rows: out };
}

/** Noten-Raster: Zahl = Skalenstufe, Array = Akkord, null = Pause. */
function notes(line: Array<number | number[] | null>): NoteGridValue {
  return {
    steps: line.length,
    cells: line.map((c) => (c === null ? [] : Array.isArray(c) ? [...c] : [c])),
  };
}

const _ = null;

/* ------------------------------------------------------------------ */
/* Vorlagen                                                            */
/* ------------------------------------------------------------------ */

const techno: ProjectTemplate = {
  id: 'techno',
  icon: '⚡',
  settings: { bpm: 132 },
  ...buildAst('techno', [
    {
      key: 'beat',
      color: 'violet',
      volume: 0.9,
      blocks: [
        {
          type: 'drums',
          params: {
            grid: drums({
              bd: 'x---x---x---x---',
              cp: '----x-------x---',
              hh: '-x-x-x-x-x-x-x-x',
              oh: '--x---x---x---x-',
            }),
            bank: 'modern',
          },
        },
        { type: 'hpf', params: { cutoff: 40 } },
      ],
    },
    {
      key: 'acidBass',
      color: 'emerald',
      volume: 0.65,
      blocks: [
        {
          type: 'melody',
          params: {
            grid: notes([_, _, 0, 0, _, _, 0, 7, _, _, 0, 0, _, 3, 0, _]),
            sound: 'sawtooth',
            root: 'A',
            scale: 'minor',
            octave: '1',
          },
        },
        { type: 'sweep', params: { min: 250, max: 2400, cycles: 8, shape: 'sine' } },
        { type: 'distort', params: { amount: 0.3 } },
        { type: 'adsr', params: { attack: 0, decay: 0.15, sustain: 0.3, release: 0.1 } },
      ],
    },
    {
      key: 'stabs',
      color: 'amber',
      volume: 0.4,
      blocks: [
        { type: 'chords', params: { custom: 'Am Am F G', sound: 'sawtooth', rhythm: 'offbeat' } },
        { type: 'degrade', params: { amount: 0.25 } },
        { type: 'lpf', params: { cutoff: 1600, resonance: 4 } },
        { type: 'delay', params: { amount: 0.35, time: '0.1875', feedback: 0.45 } },
        { type: 'room', params: { amount: 0.3, size: 4 } },
      ],
    },
  ]),
};

const lofi: ProjectTemplate = {
  id: 'lofi',
  icon: '☕',
  settings: { bpm: 84 },
  ...buildAst('lofi', [
    {
      key: 'beat',
      color: 'amber',
      volume: 0.85,
      blocks: [
        {
          type: 'drums',
          params: {
            grid: drums({
              bd: 'x------x--x-----',
              sd: '----x-------x---',
              hh: 'x-x-x-x-x-x-x-xx',
            }),
            bank: 'emu808',
          },
        },
        { type: 'lpf', params: { cutoff: 3500 } },
        { type: 'crush', params: { bits: 8 } },
      ],
    },
    {
      key: 'chords',
      color: 'violet',
      volume: 0.5,
      blocks: [
        { type: 'chords', params: { progression: '<Am7 Dm7 Em7 Am7>', sound: 'piano', rhythm: 'hold' } },
        { type: 'lpf', params: { cutoff: 1800 } },
        { type: 'room', params: { amount: 0.5, size: 4 } },
      ],
    },
    {
      key: 'melody',
      color: 'sky',
      volume: 0.5,
      blocks: [
        {
          type: 'melody',
          params: {
            // A-Moll-Pentatonik (0 = A4, 1 = C5, 2 = D5, 3 = E5, 4 = G5), ein Takt = 4 Steps (Viertel),
            // über „Langsamer ×4“ auf 4 Takte gestreckt – passend zur Akkordfolge, nur Akkordtöne:
            //   Am7: E – G E | Dm7: D – A C | Em7: G E D – | Am7: A – – –
            grid: notes([3, _, 4, 3, 2, _, 0, 1, 4, 3, 2, _, 0, _, _, _]),
            sound: 'triangle',
            root: 'A',
            scale: 'minor:pentatonic',
            octave: '4',
          },
        },
        { type: 'slow', params: { factor: 4 } },
        { type: 'adsr', params: { attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.6 } },
        { type: 'lpf', params: { cutoff: 2400 } },
        { type: 'delay', params: { amount: 0.35, time: '0.1875', feedback: 0.35 } },
        { type: 'room', params: { amount: 0.4, size: 3 } },
      ],
    },
  ]),
};

const house: ProjectTemplate = {
  id: 'house',
  icon: '🏠',
  settings: { bpm: 124 },
  ...buildAst('house', [
    {
      key: 'beat',
      color: 'rose',
      volume: 0.9,
      blocks: [
        {
          type: 'drums',
          params: {
            grid: drums({
              bd: 'x---x---x---x---',
              cp: '----x-------x---',
              hh: 'x-x-x-x-x-x-x-x-',
              oh: '--x---x---x---x-',
            }),
            bank: 'modern',
          },
        },
        { type: 'sometimes', params: { chance: 0.1, action: 'ply' } },
      ],
    },
    {
      key: 'organChords',
      color: 'cyan',
      volume: 0.5,
      blocks: [
        { type: 'chords', params: { progression: '<Am7 Dm7 Em7 Am7>', sound: 'square', rhythm: 'offbeat' } },
        { type: 'lpf', params: { cutoff: 2200 } },
        { type: 'adsr', params: { attack: 0.01, decay: 0.15, sustain: 0.2, release: 0.1 } },
        { type: 'room', params: { amount: 0.35, size: 2.5 } },
      ],
    },
    {
      key: 'bass',
      color: 'lime',
      volume: 0.6,
      blocks: [
        { type: 'code', params: { code: 'note("<a1 d2 e2 a1>").struct("[~ x ~ x]*4").s("sawtooth")' } },
        { type: 'lpf', params: { cutoff: 600, resonance: 6 } },
        { type: 'adsr', params: { attack: 0, decay: 0.1, sustain: 0.4, release: 0.05 } },
      ],
    },
  ]),
};

const ambient: ProjectTemplate = {
  id: 'ambient',
  icon: '🌌',
  settings: { bpm: 70 },
  ...buildAst('ambient', [
    {
      key: 'pad',
      color: 'fuchsia',
      volume: 0.4,
      blocks: [
        { type: 'chords', params: { progression: '<Cm Ab Eb Bb>', sound: 'supersaw', rhythm: 'hold' } },
        { type: 'sweep', params: { min: 300, max: 1800, cycles: 16, shape: 'sine' } },
        { type: 'adsr', params: { attack: 1, decay: 0.5, sustain: 0.8, release: 2 } },
        { type: 'room', params: { amount: 0.8, size: 8 } },
      ],
    },
    {
      key: 'sparkle',
      color: 'sky',
      volume: 0.35,
      blocks: [
        {
          type: 'melody',
          params: {
            grid: notes([7, _, _, 4, _, _, 9, _, _, _, 6, _, _, 2, _, _]),
            sound: 'sine',
            root: 'C',
            scale: 'minor:pentatonic',
            octave: '4',
          },
        },
        { type: 'degrade', params: { amount: 0.3 } },
        { type: 'jux' },
        { type: 'delay', params: { amount: 0.6, time: '0.375', feedback: 0.6 } },
        { type: 'room', params: { amount: 0.6, size: 6 } },
      ],
    },
    {
      key: 'bass',
      color: 'emerald',
      volume: 0.5,
      blocks: [
        {
          type: 'melody',
          // Mit „Langsamer ×4“ wird jedes Viertel zum Takt: C – Ab – Eb – Bb wie die Akkorde.
          params: {
            grid: notes([0, _, _, _, 5, _, _, _, 2, _, _, _, 6, _, _, _]),
            sound: 'sine',
            root: 'C',
            scale: 'minor',
            octave: '2',
          },
        },
        { type: 'slow', params: { factor: 4 } },
        { type: 'adsr', params: { attack: 0.3, decay: 0.5, sustain: 0.7, release: 2 } },
      ],
    },
  ]),
};

const synthwave: ProjectTemplate = {
  id: 'synthwave',
  icon: '🌆',
  settings: { bpm: 100 },
  ...buildAst('synthwave', [
    {
      key: 'beat',
      color: 'rose',
      volume: 0.85,
      blocks: [
        {
          type: 'drums',
          params: {
            grid: drums({
              bd: 'x-------x-------',
              sd: '----x-------x---',
              hh: 'x-x-x-x-x-x-x-x-',
            }),
            bank: 'analog',
          },
        },
        { type: 'room', params: { amount: 0.3, size: 1.5 } },
      ],
    },
    {
      key: 'eighthBass',
      color: 'violet',
      volume: 0.6,
      blocks: [
        {
          type: 'melody',
          // Langsamer ×4 + Stottern ×2 → Achtel, die den Akkorden folgen (A – F – C – G).
          params: {
            grid: notes([0, 0, 0, 0, 5, 5, 5, 5, 2, 2, 2, 2, 6, 6, 6, 6]),
            sound: 'sawtooth',
            root: 'A',
            scale: 'minor',
            octave: '1',
          },
        },
        { type: 'slow', params: { factor: 4 } },
        { type: 'ply', params: { times: 2 } },
        { type: 'lpf', params: { cutoff: 900, resonance: 3 } },
        { type: 'adsr', params: { attack: 0, decay: 0.12, sustain: 0.5, release: 0.08 } },
      ],
    },
    {
      key: 'chords',
      color: 'cyan',
      volume: 0.35,
      blocks: [
        { type: 'chords', params: { progression: '<Am F C G>', sound: 'supersaw', rhythm: 'hold' } },
        { type: 'lpf', params: { cutoff: 2000 } },
        { type: 'room', params: { amount: 0.5, size: 5 } },
      ],
    },
    {
      key: 'lead',
      color: 'amber',
      volume: 0.35,
      blocks: [
        {
          type: 'melody',
          params: {
            grid: notes([4, _, 4, _, 3, _, 2, _, 4, _, _, 7, 6, _, 4, _]),
            sound: 'square',
            root: 'A',
            scale: 'minor',
            octave: '4',
          },
        },
        { type: 'firstOf', params: { every: 4, action: 'up' } },
        { type: 'lpf', params: { cutoff: 2500 } },
        { type: 'delay', params: { amount: 0.4, time: '0.1875', feedback: 0.5 } },
        { type: 'pan', params: { position: 0.6 } },
      ],
    },
  ]),
};

export const TEMPLATES: ProjectTemplate[] = [techno, lofi, house, ambient, synthwave];

/**
 * Projekt einer Vorlage zum Laden: tiefe Kopie, Spurnamen in der aktuellen
 * Sprache. Die UI lädt Vorlagen ausschließlich hierüber.
 */
export function templateProject(id: string): { ast: VisualAst; settings: ProjectSettings } | undefined {
  const tpl = TEMPLATES.find((t) => t.id === id);
  if (!tpl) return undefined;
  const ast = structuredClone(tpl.ast);
  ast.nodes = ast.nodes.map((n) => {
    if (n.type !== 'track') return n;
    const index = Number(/-t(\d+)$/.exec(n.id)?.[1]) - 1;
    const key = tpl.trackKeys[index];
    return key ? { ...n, params: { ...n.params, name: templateTrackName(id, key) } } : n;
  });
  return { ast, settings: { ...tpl.settings } };
}
