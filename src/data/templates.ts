import { DRUM_INSTRUMENTS, defaultParams } from '../blocks/catalog';
import { templateSectionName, templateTrackName } from '../blocks/text';
import { translateDynamic } from '../i18n';
import type {
  Arrangement,
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
  /** Text-Keys der Song-Abschnitte (Abschnitt-ID `<id>-s<i>` ↔ sectionKeys[i-1]); nur mit Arrangement. */
  sectionKeys?: string[];
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

/** Song-Abschnitt: Länge in Takten und welche Spuren spielen (true oder Varianten-Code wie ".hpf(700)"). */
interface SectionSpec {
  /** Text-Key des Abschnittsnamens (templates.<id>.sections.<key>), darf sich wiederholen. */
  key: string;
  cycles: number;
  play: Record<string, true | string>;
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
function buildAst(
  templateId: string,
  tracks: TrackSpec[],
  sections?: SectionSpec[],
): Pick<ProjectTemplate, 'ast' | 'trackKeys' | 'sectionKeys'> {
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
  const trackKeys = tracks.map((t) => t.key);
  if (!sections) return { ast: { nodes, edges }, trackKeys };

  // Arrangement: jede Spur bekommt eine Zeile (fehlender Abschnitt = aus)
  const arrangement: Arrangement = { sections: [], cells: {}, loopSection: null };
  tracks.forEach((_t, i) => (arrangement.cells[`${templateId}-t${i + 1}`] = {}));
  sections.forEach((spec, i) => {
    const id = `${templateId}-s${i + 1}`;
    const name = translateDynamic('en', `templates.${templateId}.sections.${spec.key}`) ?? spec.key;
    arrangement.sections.push({ id, cycles: spec.cycles, name });
    for (const [key, play] of Object.entries(spec.play)) {
      const index = trackKeys.indexOf(key);
      if (index < 0) throw new Error(`Vorlage ${templateId}: unbekannte Spur „${key}“ in Abschnitt ${spec.key}`);
      arrangement.cells[`${templateId}-t${index + 1}`]![id] = play === true ? { on: true } : { on: true, code: play };
    }
  });
  return { ast: { nodes, edges, arrangement }, trackKeys, sectionKeys: sections.map((s) => s.key) };
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

/** Noten-Raster: Zahl = Skalenstufe, Array = Akkord, null = Pause. Mehrere Takte: `line` = steps × bars. */
function notes(line: Array<number | number[] | null>, bars = 1): NoteGridValue {
  return {
    steps: line.length / bars,
    ...(bars > 1 ? { bars } : {}),
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
        {
          type: 'melody',
          // Offbeat-Sechzehntel, ein Grundton pro Takt (A-Moll ab A1: 0 = A1, 3 = D2, 4 = E2).
          params: {
            grid: notes(
              [
                ...[_, 0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 0],
                ...[_, 3, _, 3, _, 3, _, 3, _, 3, _, 3, _, 3, _, 3],
                ...[_, 4, _, 4, _, 4, _, 4, _, 4, _, 4, _, 4, _, 4],
                ...[_, 0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 0],
              ],
              4,
            ),
            sound: 'sawtooth',
            root: 'A',
            scale: 'minor',
            octave: '1',
          },
        },
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

/**
 * Riff-Raster aus lesbaren Takt-Strings: Zeichen aus `voicing` = Anschlag (Stufen),
 * "-" = vorherigen Ton halten, alles andere = Pause.
 */
function riff(bars: string[], voicing: Record<string, number[]>): NoteGridValue {
  const line = bars.join('');
  const cells: number[][] = [];
  const lengths: number[][] = [];
  for (let i = 0; i < line.length; i++) {
    const hit = voicing[line[i]!];
    let len = 1;
    while (hit && line[i + len] === '-') len++;
    cells.push(hit ? [...hit] : []);
    lengths.push(hit ? hit.map(() => len) : []);
  }
  return { steps: line.length / bars.length, bars: bars.length, cells, lengths };
}

// 16-Bit-Rock in E-Moll (Stufen: 0 = E, 3 = A, 4 = B, 7 = E eine Oktave höher).
// Statt echte Gitarren nachzuahmen: Square/Sägezahn, Bitcrusher und Echo im 16-Bit-Stil.
// Boogie-Bass mit Oktavsprung pro Takt: Grundton, Grundton, Oktave, Grundton, kl. Septime, Grundton, Quinte, Quarte.
const boogie = (root: number) => [0, 0, 7, 0, 6, 0, 4, 3].map((d) => root + d);
// Akkordfolge: E | E | A | B (Turnaround)
const CHIP_CHORDS = { E: [0, 4, 7], A: [3, 7, 10], B: [4, 8, 11] };
const DIGITS = Object.fromEntries(Array.from({ length: 10 }, (_, d) => [String(d), [d]]));
/** Bitcrusher + reduzierte Samplerate: der körnige 16-Bit-Klang. */
const CHIP_FX: BlockSpec[] = [
  { type: 'crush', params: { bits: 10 } },
  { type: 'coarse', params: { amount: 2 } },
];

const chiprock: ProjectTemplate = {
  id: 'chiprock',
  icon: '🏁',
  settings: { bpm: 150 },
  ...buildAst(
    'chiprock',
    [
      {
        key: 'beat',
        color: 'amber',
        volume: 0.85,
        blocks: [
          {
            type: 'drums',
            params: {
              grid: drums({
                bd: 'x-----x-x-x-----',
                sd: '----x-------x---',
                hh: 'x-x-x-x-x-x-x-x-',
              }),
              bank: 'analog',
            },
          },
          ...CHIP_FX,
        ],
      },
      {
        key: 'bass',
        color: 'violet',
        volume: 0.6,
        blocks: [
          {
            type: 'melody',
            params: {
              grid: notes([...boogie(0), ...boogie(0), ...boogie(3), ...boogie(4)], 4),
              sound: 'sawtooth',
              root: 'E',
              scale: 'minor',
              octave: '1',
            },
          },
          { type: 'lpf', params: { cutoff: 1200, resonance: 4 } },
          { type: 'adsr', params: { attack: 0, decay: 0.12, sustain: 0.5, release: 0.05 } },
          ...CHIP_FX,
        ],
      },
      {
        key: 'stabs',
        color: 'rose',
        volume: 0.35,
        blocks: [
          {
            type: 'melody',
            // Synkopierte Akkord-Stabs (3 + 3 + 2), im letzten Takt nachgeschoben
            params: {
              grid: riff(['E..E..E.', 'E..E..E.', 'A..A..A.', 'B..B.B.B'], CHIP_CHORDS),
              sound: 'square',
              root: 'E',
              scale: 'minor',
              octave: '3',
            },
          },
          { type: 'adsr', params: { attack: 0, decay: 0.1, sustain: 0.2, release: 0.05 } },
          { type: 'lpf', params: { cutoff: 2600 } },
          ...CHIP_FX,
          { type: 'pan', params: { position: 0.35 } },
        ],
      },
      {
        key: 'lead',
        color: 'sky',
        volume: 0.35,
        blocks: [
          {
            type: 'melody',
            // Pentatonik-Lead (0 = E4, 3 = B4, 5 = E5, 8 = B5): B E G A | B – A G | A – G E | B D B –
            params: {
              grid: riff(['3-5-6-7-', '8---7-6-', '7---6-5-', '3-4-3---'], DIGITS),
              sound: 'square',
              root: 'E',
              scale: 'minor:pentatonic',
              octave: '4',
            },
          },
          { type: 'vib', params: { rate: 6, depth: 0.2 } },
          { type: 'adsr', params: { attack: 0.005, decay: 0.2, sustain: 0.7, release: 0.1 } },
          { type: 'lpf', params: { cutoff: 4000 } },
          { type: 'crush', params: { bits: 10 } },
          // Echo
          { type: 'delay', params: { amount: 0.4, time: '0.375', feedback: 0.5 } },
          { type: 'pan', params: { position: 0.65 } },
        ],
      },
    ],
    [
      { key: 'intro', cycles: 4, play: { bass: true } },
      { key: 'riff', cycles: 8, play: { beat: true, bass: true, stabs: true } },
      { key: 'lead', cycles: 8, play: { beat: true, bass: true, stabs: true, lead: true } },
      { key: 'break', cycles: 4, play: { beat: '.ply("<1 1 1 2>")', bass: '.lpf(500)' } },
      { key: 'lead', cycles: 8, play: { beat: true, bass: true, stabs: true, lead: true } },
    ],
  ),
};

export const TEMPLATES: ProjectTemplate[] = [techno, lofi, house, ambient, synthwave, chiprock];

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
  ast.arrangement?.sections.forEach((s, i) => {
    const key = tpl.sectionKeys?.[i];
    if (key) s.name = templateSectionName(id, key);
  });
  return { ast, settings: { ...tpl.settings } };
}
