import type {
  BlockDef,
  BlockKind,
  BlockType,
  CatalogOption,
  DrumGridValue,
  NoteGridValue,
  NumberParamDef,
  OptionSetId,
  ParamValues,
  SelectParamDef,
  TrackColor,
} from '../types/ast';

/**
 * Block-Katalog – Single Source of Truth für alle verfügbaren Bausteine.
 * UI (Picker, Parameter-Panel) und Compiler lesen ausschließlich hier.
 *
 * Nur Struktur – alle Anzeigetexte stehen in src/i18n/<sprache>/blocks.json
 * (Zugriff über src/blocks/text.ts).
 */

export const STEPS = 16;

const values = (...v: string[]): CatalogOption[] => v.map((value) => ({ value }));

/** Drum-Instrumente = Sample-Namen (Anzeigename über `instrumentLabel()`). */
export const DRUM_INSTRUMENTS: readonly CatalogOption[] = values('bd', 'sd', 'cp', 'hh', 'oh', 'rim');

/**
 * Alle Auswahllisten. Die Werte landen im Strudel-Code bzw. im Projekt; die
 * Anzeigetexte stehen unter blocks.options.<set>.<wert> (Punkte im Wert als „_“).
 */
export const OPTION_SETS: Record<OptionSetId, readonly CatalogOption[]> = {
  banks: values('modern', 'analog', 'emu808'),
  sounds: values('sawtooth', 'square', 'triangle', 'sine', 'supersaw', 'piano'),
  notes: values('C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'),
  /** Strudel-Skalennamen (Leerzeichen als ":" kodiert). */
  scales: values(
    'minor',
    'major',
    'minor:pentatonic',
    'major:pentatonic',
    'dorian',
    'phrygian',
    'mixolydian',
    'harmonic:minor',
  ),
  octaves: values('1', '2', '3', '4', '5'),
  delayTimes: values('0.125', '0.1875', '0.25', '0.375'),
  lfoShapes: values('sine', 'saw', 'tri', 'square', 'perlin'),
  progressions: values('<Am F C G>', '<C G Am F>', '<Dm7 G7 C^7 C^7>', '<Am7 Dm7 Em7 Am7>', '<Cm Ab Eb Bb>'),
  rhythms: values('hold', 'quarter', 'offbeat'),
  variationActions: values('rev', 'fast', 'up', 'degrade'),
  sometimesActions: values('ply', 'up', 'crush'),
  sweepFilters: values('lpf', 'hpf'),
  /** Waveshaping-Algorithmen von superdough (`distorttype`), „scurve“ = Standard. */
  distortTypes: values('scurve', 'soft', 'hard', 'cubic', 'diode', 'asym', 'fold', 'sinefold', 'chebyshev'),
  /** Zeitversatz in Zyklen (1 Zyklus = 1 Takt). */
  offsets: values('0.0625', '0.125', '0.1875', '0.25', '0.5'),
  /** Intervalle in Halbtönen. */
  intervals: values('12', '7', '5', '0', '-12'),
  swingGrids: values('4', '8'),
  lingerParts: values('0.5', '0.25', '0.125'),
  shuffleModes: values('shuffle', 'scramble'),
  arpModes: values('up', 'down', 'updown', 'converge'),
  vowels: values('a', 'e', 'i', 'o', 'u', '<a e i o u>'),
  /** Tremolo-Schläge pro Takt (`tremolosync`). */
  tremoloRates: values('2', '4', '8', '16'),
  fmWaves: values('sine', 'triangle', 'square', 'sawtooth'),
};

/** Arpeggio-Muster (Indizes in den gleichzeitig klingenden Akkordtönen). */
export const ARP_PATTERNS: Record<string, string> = {
  up: '0 1 2 3',
  down: '3 2 1 0',
  updown: '0 1 2 3 2 1',
  converge: '0 3 1 2',
};

export const DRUM_BANKS = OPTION_SETS.banks;
export const SYNTH_SOUNDS = OPTION_SETS.sounds;
export const ROOT_NOTES = OPTION_SETS.notes;
export const SCALES = OPTION_SETS.scales;
export const OCTAVES = OPTION_SETS.octaves;
export const DELAY_TIMES = OPTION_SETS.delayTimes;
export const LFO_SHAPES = OPTION_SETS.lfoShapes;

/** Auswahl-Parameter, dessen Optionen aus einer benannten Liste kommen. */
function select(key: string, optionSet: OptionSetId, def: string, advanced?: boolean): SelectParamDef {
  const options = OPTION_SETS[optionSet];
  return { key, type: 'select', optionSet, options, default: def, ...(advanced ? { advanced } : {}) };
}

export const TRACK_COLORS: TrackColor[] = ['violet', 'sky', 'emerald', 'amber', 'rose', 'cyan', 'lime', 'fuchsia'];

export function emptyDrumGrid(steps = STEPS): DrumGridValue {
  return {
    steps,
    rows: Object.fromEntries(DRUM_INSTRUMENTS.map((i) => [i.value, Array<boolean>(steps).fill(false)])),
  };
}

export function emptyNoteGrid(steps = STEPS): NoteGridValue {
  return { steps, cells: Array.from({ length: steps }, () => [] as number[]) };
}

function basicBeat(): DrumGridValue {
  const g = emptyDrumGrid();
  [0, 4, 8, 12].forEach((i) => (g.rows.bd![i] = true));
  [4, 12].forEach((i) => (g.rows.sd![i] = true));
  [2, 6, 10, 14].forEach((i) => (g.rows.hh![i] = true));
  return g;
}

function basicMelody(): NoteGridValue {
  const g = emptyNoteGrid();
  const line: Array<number | null> = [0, null, 2, null, 4, null, 2, null, 0, null, 4, 5, 4, null, 2, null];
  line.forEach((d, i) => (g.cells[i] = d === null ? [] : [d]));
  return g;
}

/** Zahl-Parameter (kurz): num('amount', 0, 1, 0.01, 0.5, { unit: 's', advanced: true }). */
function num(
  key: string,
  min: number,
  max: number,
  step: number,
  def: number,
  extra: Pick<NumberParamDef, 'unit' | 'log' | 'advanced'> = {},
): NumberParamDef {
  return { key, type: 'number', min, max, step, default: def, ...extra };
}

export const BLOCK_CATALOG: { [T in BlockType]: BlockDef<T> } = {
  /* ---------------------------- Klangquellen ---------------------------- */
  drums: {
    type: 'drums',
    kind: 'source',
    icon: '🥁',
    params: [
      { key: 'grid', type: 'drumGrid', instruments: DRUM_INSTRUMENTS, default: basicBeat() },
      select('bank', 'banks', 'modern'),
    ],
    covers: ['s', 'bank'],
  },
  melody: {
    type: 'melody',
    kind: 'source',
    icon: '🎹',
    params: [
      { key: 'grid', type: 'noteGrid', degrees: 15, default: basicMelody() },
      select('sound', 'sounds', 'sawtooth'),
      select('root', 'notes', 'C'),
      select('scale', 'scales', 'minor'),
      select('octave', 'octaves', '3'),
    ],
    covers: ['n', 'scale', 's', 'slow'],
  },
  chords: {
    type: 'chords',
    kind: 'source',
    icon: '🎼',
    params: [
      select('progression', 'progressions', '<Am F C G>'),
      { key: 'custom', type: 'text', syntax: 'mini', default: '', advanced: true },
      select('sound', 'sounds', 'piano'),
      select('rhythm', 'rhythms', 'hold'),
    ],
    covers: ['chord', 'voicing', 'struct', 's'],
  },
  sample: {
    type: 'sample',
    kind: 'source',
    icon: '🎧',
    params: [
      { key: 'pattern', type: 'text', syntax: 'mini', default: 'tabla*2 ~ tabla:3 ~' },
      num('speed', -2, 3, 0.05, 1, { advanced: true }),
    ],
    covers: ['s', 'speed'],
  },
  code: {
    type: 'code',
    kind: 'source',
    icon: '⌨️',
    params: [
      { key: 'code', type: 'text', syntax: 'code', default: 's("bd*2 [~ sd] bd sd").bank("emu808")' },
    ],
    covers: [],
  },

  /* ------------------------------ Rhythmus ------------------------------ */
  fast: {
    type: 'fast',
    kind: 'modifier',
    icon: '⏩',
    params: [num('factor', 1, 8, 0.25, 2, { unit: '×' })],
    covers: ['fast'],
  },
  slow: {
    type: 'slow',
    kind: 'modifier',
    icon: '⏪',
    params: [num('factor', 1, 8, 0.25, 2, { unit: '×' })],
    covers: ['slow'],
  },
  rev: {
    type: 'rev',
    kind: 'modifier',
    icon: '🔁',
    params: [],
    covers: ['rev'],
  },
  firstOf: {
    type: 'firstOf',
    kind: 'modifier',
    icon: '🔀',
    params: [num('every', 2, 16, 1, 4), select('action', 'variationActions', 'fast')],
    covers: ['firstOf', 'rev', 'fast', 'transpose', 'speed', 'degradeBy'],
  },
  degrade: {
    type: 'degrade',
    kind: 'modifier',
    icon: '🎲',
    params: [num('amount', 0, 1, 0.05, 0.3)],
    covers: ['degradeBy'],
  },
  ply: {
    type: 'ply',
    kind: 'modifier',
    icon: '〰️',
    params: [num('times', 2, 8, 1, 2)],
    covers: ['ply'],
  },
  jux: {
    type: 'jux',
    kind: 'modifier',
    icon: '🎭',
    params: [num('width', 0, 1, 0.05, 1, { advanced: true })],
    covers: ['jux', 'juxBy', 'rev'],
  },
  sometimes: {
    type: 'sometimes',
    kind: 'modifier',
    icon: '✨',
    params: [num('chance', 0, 1, 0.05, 0.25), select('action', 'sometimesActions', 'ply')],
    covers: ['sometimesBy', 'ply', 'transpose', 'speed', 'crush'],
  },
  euclid: {
    type: 'euclid',
    kind: 'modifier',
    icon: '⭕',
    params: [num('pulses', 1, 16, 1, 3), num('steps', 2, 32, 1, 8), num('rotation', 0, 31, 1, 0, { advanced: true })],
    covers: ['euclid', 'euclidRot'],
  },
  off: {
    type: 'off',
    kind: 'modifier',
    icon: '👥',
    params: [select('time', 'offsets', '0.125'), select('interval', 'intervals', '12')],
    covers: ['off', 'transpose', 'speed'],
  },
  echo: {
    type: 'echo',
    kind: 'modifier',
    icon: '🔉',
    params: [num('times', 2, 8, 1, 3), select('time', 'offsets', '0.125'), num('feedback', 0, 1, 0.05, 0.6)],
    covers: ['echoWith', 'velocity'],
  },
  chunk: {
    type: 'chunk',
    kind: 'modifier',
    icon: '🧩',
    params: [num('parts', 2, 8, 1, 4), select('action', 'variationActions', 'fast')],
    covers: ['fastChunk', 'rev', 'fast', 'transpose', 'speed', 'degradeBy'],
  },
  iter: {
    type: 'iter',
    kind: 'modifier',
    icon: '🔄',
    params: [num('parts', 2, 8, 1, 4), { key: 'backwards', type: 'toggle', default: false, advanced: true }],
    covers: ['iter', 'iterBack'],
  },
  palindrome: {
    type: 'palindrome',
    kind: 'modifier',
    icon: '↩️',
    params: [],
    covers: ['palindrome'],
  },
  swing: {
    type: 'swing',
    kind: 'modifier',
    icon: '🕺',
    params: [num('amount', 0, 1, 0.01, 0.33), select('grid', 'swingGrids', '4')],
    covers: ['swingBy'],
  },
  linger: {
    type: 'linger',
    kind: 'modifier',
    icon: '🔂',
    params: [select('part', 'lingerParts', '0.25')],
    covers: ['linger'],
  },
  segment: {
    type: 'segment',
    kind: 'modifier',
    icon: '📶',
    params: [num('steps', 1, 32, 1, 8)],
    covers: ['segment'],
  },
  shuffle: {
    type: 'shuffle',
    kind: 'modifier',
    icon: '🃏',
    params: [num('parts', 2, 16, 1, 4), select('mode', 'shuffleModes', 'shuffle')],
    covers: ['shuffle', 'scramble'],
  },
  mask: {
    type: 'mask',
    kind: 'modifier',
    icon: '🎚️',
    params: [{ key: 'pattern', type: 'text', syntax: 'mini', default: '<1 1 1 [1 0]>' }],
    covers: ['mask'],
  },

  /* ------------------------------ Tonhöhe ------------------------------- */
  transpose: {
    type: 'transpose',
    kind: 'modifier',
    icon: '↕️',
    params: [num('semitones', -24, 24, 1, 12, { unit: 'semitones' })],
    covers: ['transpose', 'speed'],
  },
  scaleTranspose: {
    type: 'scaleTranspose',
    kind: 'modifier',
    icon: '🪜',
    params: [num('steps', -14, 14, 1, 2, { unit: 'steps' })],
    covers: ['scaleTranspose'],
  },
  arp: {
    type: 'arp',
    kind: 'modifier',
    icon: '🌈',
    params: [
      select('mode', 'arpModes', 'up'),
      num('speed', 1, 4, 1, 2, { unit: '×' }),
      { key: 'custom', type: 'text', syntax: 'mini', default: '', advanced: true },
    ],
    covers: ['arp'],
  },
  superimpose: {
    type: 'superimpose',
    kind: 'modifier',
    icon: '🥞',
    params: [select('interval', 'intervals', '12')],
    covers: ['superimpose', 'transpose', 'speed'],
  },
  vib: {
    type: 'vib',
    kind: 'modifier',
    icon: '〽️',
    params: [num('rate', 0.5, 16, 0.1, 5, { unit: 'Hz', log: true }), num('depth', 0, 2, 0.05, 0.3, { unit: 'semitones' })],
    covers: ['vib', 'vibmod'],
  },

  /* ------------------------------ Samples ------------------------------- */
  chop: {
    type: 'chop',
    kind: 'modifier',
    icon: '🔪',
    params: [num('parts', 2, 32, 1, 4)],
    covers: ['chop'],
  },
  striate: {
    type: 'striate',
    kind: 'modifier',
    icon: '🧵',
    params: [num('parts', 2, 32, 1, 4)],
    covers: ['striate'],
  },
  slice: {
    type: 'slice',
    kind: 'modifier',
    icon: '🍰',
    params: [num('parts', 2, 16, 1, 8), { key: 'order', type: 'text', syntax: 'mini', default: '0 2 1 3 4 6 5 7' }],
    covers: ['slice'],
  },
  loopAt: {
    type: 'loopAt',
    kind: 'modifier',
    icon: '➰',
    params: [num('bars', 1, 16, 1, 2, { unit: 'bars' })],
    covers: ['loopAt'],
  },
  'code-mod': {
    type: 'code-mod',
    kind: 'modifier',
    icon: '⌨️',
    params: [
      { key: 'code', type: 'text', syntax: 'code', default: '.off(1/8, x => x.add(note(12)))' },
    ],
    covers: [],
  },

  /* ------------------------------- Effekte ------------------------------- */
  lpf: {
    type: 'lpf',
    kind: 'effect',
    icon: '🌙',
    params: [num('cutoff', 80, 12000, 1, 1200, { unit: 'Hz', log: true }), num('resonance', 0, 25, 0.5, 1, { advanced: true })],
    covers: ['lpf', 'lpq'],
  },
  hpf: {
    type: 'hpf',
    kind: 'effect',
    icon: '☀️',
    params: [num('cutoff', 20, 8000, 1, 300, { unit: 'Hz', log: true }), num('resonance', 0, 25, 0.5, 1, { advanced: true })],
    covers: ['hpf', 'hpq'],
  },
  sweep: {
    type: 'sweep',
    kind: 'effect',
    icon: '🌊',
    params: [
      num('min', 80, 8000, 1, 300, { unit: 'Hz', log: true }),
      num('max', 200, 12000, 1, 3000, { unit: 'Hz', log: true }),
      num('cycles', 1, 32, 1, 4, { unit: 'bars' }),
      select('shape', 'lfoShapes', 'sine', true),
      select('filter', 'sweepFilters', 'lpf', true),
    ],
    covers: ['lpf', 'hpf', 'range', 'slow', 'sine', 'saw', 'tri', 'square', 'perlin'],
  },
  filterEnv: {
    type: 'filterEnv',
    kind: 'effect',
    icon: '🦆',
    params: [
      num('cutoff', 50, 8000, 1, 300, { unit: 'Hz', log: true }),
      num('amount', -8, 8, 0.1, 4),
      num('attack', 0, 2, 0.01, 0.01, { unit: 's' }),
      num('decay', 0, 2, 0.01, 0.2, { unit: 's' }),
      num('sustain', 0, 1, 0.01, 0, { advanced: true }),
      num('release', 0, 2, 0.01, 0.1, { unit: 's', advanced: true }),
      num('resonance', 0, 25, 0.5, 1, { advanced: true }),
    ],
    covers: ['lpf', 'lpq', 'lpenv', 'lpa', 'lpd', 'lps', 'lpr'],
  },
  room: {
    type: 'room',
    kind: 'effect',
    icon: '⛪',
    params: [num('amount', 0, 1, 0.01, 0.4), num('size', 0.5, 10, 0.1, 3, { advanced: true })],
    covers: ['room', 'roomsize'],
  },
  delay: {
    type: 'delay',
    kind: 'effect',
    icon: '📣',
    params: [
      num('amount', 0, 1, 0.01, 0.4),
      select('time', 'delayTimes', '0.1875'),
      num('feedback', 0, 0.9, 0.01, 0.5, { advanced: true }),
    ],
    covers: ['delay', 'delaysync', 'delayfeedback'],
  },
  pan: {
    type: 'pan',
    kind: 'effect',
    icon: '↔️',
    params: [num('position', 0, 1, 0.01, 0.5)],
    covers: ['pan'],
  },
  adsr: {
    type: 'adsr',
    kind: 'effect',
    icon: '📈',
    params: [
      num('attack', 0, 2, 0.01, 0.01, { unit: 's' }),
      num('decay', 0, 2, 0.01, 0.2, { unit: 's', advanced: true }),
      num('sustain', 0, 1, 0.01, 0.6, { advanced: true }),
      num('release', 0, 4, 0.01, 0.3, { unit: 's' }),
    ],
    covers: ['attack', 'decay', 'sustain', 'release'],
  },
  crush: {
    type: 'crush',
    kind: 'effect',
    icon: '👾',
    params: [num('bits', 1, 16, 1, 6, { unit: 'bit' })],
    covers: ['crush'],
  },
  coarse: {
    type: 'coarse',
    kind: 'effect',
    icon: '📼',
    params: [num('amount', 1, 32, 1, 4, { unit: '×' })],
    covers: ['coarse'],
  },
  distort: {
    type: 'distort',
    kind: 'effect',
    icon: '🔥',
    params: [num('amount', 0, 1, 0.01, 0.3), select('type', 'distortTypes', 'scurve', true)],
    covers: ['distort', 'distorttype'],
  },
  vowel: {
    type: 'vowel',
    kind: 'effect',
    icon: '🗣️',
    params: [select('vowel', 'vowels', 'a')],
    covers: ['vowel'],
  },
  phaser: {
    type: 'phaser',
    kind: 'effect',
    icon: '🌀',
    params: [num('rate', 0.1, 16, 0.1, 2, { unit: 'Hz', log: true }), num('depth', 0, 1, 0.01, 0.75, { advanced: true })],
    covers: ['phaser', 'phaserdepth'],
  },
  tremolo: {
    type: 'tremolo',
    kind: 'effect',
    icon: '💓',
    params: [select('rate', 'tremoloRates', '8'), num('depth', 0, 1, 0.01, 0.6)],
    covers: ['tremolosync', 'tremolodepth'],
  },
  fm: {
    type: 'fm',
    kind: 'effect',
    icon: '📻',
    params: [
      num('amount', 0, 16, 0.1, 2),
      num('ratio', 0.25, 8, 0.01, 1, { log: true }),
      select('wave', 'fmWaves', 'sine', true),
      num('decay', 0, 2, 0.01, 0, { unit: 's', advanced: true }),
      num('sustain', 0, 1, 0.01, 0.2, { advanced: true }),
    ],
    covers: ['fm', 'fmh', 'fmwave', 'fmdecay', 'fmsustain'],
  },
  compressor: {
    type: 'compressor',
    kind: 'effect',
    icon: '🗜️',
    params: [
      num('threshold', -60, 0, 1, -20, { unit: 'dB' }),
      num('ratio', 1, 20, 0.5, 4, { unit: '×' }),
      num('knee', 0, 40, 1, 10, { unit: 'dB', advanced: true }),
      num('attack', 0, 0.5, 0.001, 0.005, { unit: 's', advanced: true }),
      num('release', 0, 1, 0.01, 0.05, { unit: 's', advanced: true }),
    ],
    covers: ['compressor', 'compressorRatio', 'compressorKnee', 'compressorAttack', 'compressorRelease'],
  },
  postgain: {
    type: 'postgain',
    kind: 'effect',
    icon: '🔊',
    params: [num('level', 0, 4, 0.05, 1.5, { unit: '×' })],
    covers: ['postgain'],
  },
  sampleRange: {
    type: 'sampleRange',
    kind: 'effect',
    icon: '✂️',
    params: [num('begin', 0, 1, 0.01, 0), num('end', 0, 1, 0.01, 0.5)],
    covers: ['begin', 'end'],
  },
  cut: {
    type: 'cut',
    kind: 'effect',
    icon: '🤫',
    params: [num('group', 1, 8, 1, 1)],
    covers: ['cut'],
  },
  param: {
    type: 'param',
    kind: 'effect',
    icon: '🎛️',
    params: [
      { key: 'name', type: 'text', syntax: 'plain', default: 'velocity' },
      { key: 'value', type: 'text', syntax: 'mini', default: '1 0.6' },
    ],
    // deckt jeden Control aus src/blocks/controls.ts ab (dynamisch, daher leer)
    covers: [],
  },
  'code-fx': {
    type: 'code-fx',
    kind: 'effect',
    icon: '⌨️',
    params: [
      { key: 'code', type: 'text', syntax: 'code', default: '.vowel("<a e i o>")' },
    ],
    covers: [],
  },
};

/** Block-Kategorien in Anzeige-Reihenfolge (Texte über `kindLabel()`). */
export const BLOCK_KINDS: readonly BlockKind[] = ['source', 'modifier', 'effect'];

export function getBlockDef(type: BlockType): BlockDef {
  return BLOCK_CATALOG[type];
}

export function blocksOfKind(kind: BlockKind): BlockDef[] {
  return (Object.values(BLOCK_CATALOG) as BlockDef[]).filter((d) => d.kind === kind);
}

/** Erzeugt tief kopierte Default-Parameter für einen Blocktyp. */
export function defaultParams(type: BlockType): ParamValues {
  const def = getBlockDef(type);
  return Object.fromEntries(def.params.map((p) => [p.key, structuredClone(p.default)]));
}
