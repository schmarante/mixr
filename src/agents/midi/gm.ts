/**
 * General-MIDI-Wissen für Import und Export: Programmnamen, Drum-Noten,
 * Zuordnung zu mixr-Klängen und -Drum-Instrumenten.
 */
import { recipeFor, type Recipe } from '../importer/sounds';

/** GM-Programmnamen (0–127), englisch wie in der Spezifikation. */
export const GM_PROGRAMS: readonly string[] = [
  'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano', 'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
  'Acoustic Guitar (nylon)', 'Acoustic Guitar (steel)', 'Electric Guitar (jazz)', 'Electric Guitar (clean)', 'Electric Guitar (muted)', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
  'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass', 'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
  'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
  'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)', 'Lead 5 (charang)', 'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass + lead)',
  'Pad 1 (new age)', 'Pad 2 (warm)', 'Pad 3 (polysynth)', 'Pad 4 (choir)', 'Pad 5 (bowed)', 'Pad 6 (metallic)', 'Pad 7 (halo)', 'Pad 8 (sweep)',
  'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)', 'FX 5 (brightness)', 'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)',
  'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot',
];

export function programName(program: number): string {
  return GM_PROGRAMS[program] ?? `Program ${program + 1}`;
}

/** MIDI-Kanal der GM-Drums (0-basiert, „Kanal 10“). */
export const DRUM_CHANNEL = 9;

/**
 * Klang + Ersatz-Rezept für ein GM-Programm. Die Synths von mixr haben feste
 * Programme (Export) – die Rundreise ergibt wieder denselben Klang.
 */
export function soundForProgram(program: number): { sound: string; recipe: Recipe | null } {
  const direct = PROGRAM_SOUND[program];
  if (direct) return { sound: direct, recipe: null };
  if (program >= 0 && program <= 7) return { sound: 'piano', recipe: null };
  const name = `gm_${programName(program).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
  const recipe = recipeFor(name);
  return recipe ? { sound: recipe.sound, recipe } : { sound: 'piano', recipe: null };
}

/** Programme, die direkt einem mixr-Synth entsprechen (beide Richtungen). */
const PROGRAM_SOUND: Record<number, string> = {
  0: 'piano',
  80: 'square',
  81: 'sawtooth',
  82: 'triangle',
  79: 'sine',
  90: 'supersaw',
};

/** mixr-Klang → GM-Programm für den Export. */
export function programForSound(sound: string | undefined): number {
  const s = (sound ?? '').toLowerCase().replace(/:\d+$/, '');
  switch (s) {
    case 'piano':
      return 0;
    case 'square':
    case 'sqr':
    case 'pulse':
      return 80;
    case 'sawtooth':
    case 'saw':
      return 81;
    case 'triangle':
    case 'tri':
      return 82;
    case 'sine':
    case 'sin':
      return 79;
    case 'supersaw':
      return 90;
    case 'bass':
      return 38;
    default:
      return 81;
  }
}

/* ------------------------------------------------------------------ */
/* Drums                                                               */
/* ------------------------------------------------------------------ */

/** GM-Percussion-Namen (Noten 27–87). */
const GM_DRUM_NAMES: Record<number, string> = {
  27: 'High Q', 28: 'Slap', 29: 'Scratch Push', 30: 'Scratch Pull', 31: 'Sticks', 32: 'Square Click', 33: 'Metronome Click', 34: 'Metronome Bell',
  35: 'Acoustic Bass Drum', 36: 'Bass Drum', 37: 'Side Stick', 38: 'Acoustic Snare', 39: 'Hand Clap', 40: 'Electric Snare',
  41: 'Low Floor Tom', 42: 'Closed Hi-Hat', 43: 'High Floor Tom', 44: 'Pedal Hi-Hat', 45: 'Low Tom', 46: 'Open Hi-Hat',
  47: 'Low-Mid Tom', 48: 'Hi-Mid Tom', 49: 'Crash Cymbal 1', 50: 'High Tom', 51: 'Ride Cymbal 1', 52: 'Chinese Cymbal',
  53: 'Ride Bell', 54: 'Tambourine', 55: 'Splash Cymbal', 56: 'Cowbell', 57: 'Crash Cymbal 2', 58: 'Vibraslap',
  59: 'Ride Cymbal 2', 60: 'Hi Bongo', 61: 'Low Bongo', 62: 'Mute Hi Conga', 63: 'Open Hi Conga', 64: 'Low Conga',
  65: 'High Timbale', 66: 'Low Timbale', 67: 'High Agogo', 68: 'Low Agogo', 69: 'Cabasa', 70: 'Maracas',
  71: 'Short Whistle', 72: 'Long Whistle', 73: 'Short Guiro', 74: 'Long Guiro', 75: 'Claves', 76: 'Hi Wood Block',
  77: 'Low Wood Block', 78: 'Mute Cuica', 79: 'Open Cuica', 80: 'Mute Triangle', 81: 'Open Triangle', 82: 'Shaker',
  83: 'Jingle Bell', 84: 'Belltree', 85: 'Castanets', 86: 'Mute Surdo', 87: 'Open Surdo',
};

export function drumNoteName(note: number): string {
  return GM_DRUM_NAMES[note] ?? `Note ${note}`;
}

/** Exakte GM-Entsprechungen der sechs Raster-Instrumente. */
const EXACT_DRUMS: Record<number, string> = { 35: 'bd', 36: 'bd', 37: 'rim', 38: 'sd', 39: 'cp', 40: 'sd', 42: 'hh', 44: 'hh', 46: 'oh' };

/**
 * Ähnlichste Raster-Instrumente für die übrigen GM-Drums (wie die Drum-Aliase des
 * Code-Importers: tiefe Toms → Kick, hohe Toms/Holz/Glocken → Rimshot, Becken → Open Hat,
 * Rasseln → Hi-Hat).
 */
function nearestDrum(note: number): string | null {
  if (note === 41 || note === 43 || note === 45 || note === 86 || note === 87 || note === 64 || note === 66) return 'bd';
  if (note === 47 || note === 48 || note === 50 || (note >= 60 && note <= 68) || note === 56 || note === 75 || note === 76 || note === 77 || note === 31 || note === 37 || note === 85) return 'rim';
  if (note === 49 || note === 51 || note === 52 || note === 53 || note === 55 || note === 57 || note === 59 || note === 81 || note === 83 || note === 84) return 'oh';
  if (note === 54 || note === 69 || note === 70 || note === 82 || note === 80 || note === 73 || note === 74) return 'hh';
  if (note === 28 || note === 39) return 'cp';
  if (note === 27 || note === 29 || note === 30 || note === 32 || note === 33 || note === 34 || note === 58 || note === 71 || note === 72 || note === 78 || note === 79) return 'rim';
  return null;
}

/** GM-Drum-Note → Raster-Instrument; `exact` = gleicher Klangtyp. */
export function drumForNote(note: number): { inst: string; exact: boolean } | null {
  const exact = EXACT_DRUMS[note];
  if (exact) return { inst: exact, exact: true };
  const near = nearestDrum(note);
  return near ? { inst: near, exact: false } : null;
}

/** Raster-Instrument bzw. Drum-Kürzel → GM-Note (Export). */
const DRUM_TO_NOTE: Record<string, number> = {
  bd: 36,
  kick: 36,
  sbd: 36,
  sd: 38,
  sn: 38,
  snare: 38,
  cp: 39,
  clap: 39,
  hh: 42,
  ch: 42,
  hc: 42,
  hat: 42,
  hihat: 42,
  oh: 46,
  ho: 46,
  rim: 37,
  rs: 37,
  cl: 75,
  cr: 49,
  crash: 49,
  cy: 49,
  rd: 51,
  ride: 51,
  sh: 82,
  shaker: 82,
  tb: 54,
  lt: 45,
  mt: 47,
  ht: 50,
  tom: 47,
  cb: 56,
  cowbell: 56,
};

export function noteForDrum(name: string): number | null {
  return DRUM_TO_NOTE[name.toLowerCase()] ?? null;
}

/** Andere (nicht-Drum-)Samples als Perkussion: grob passende GM-Note. */
const SAMPLE_PERCUSSION: Record<string, number> = {
  tabla: 60,
  perc: 75,
  elec: 76,
  glitch: 54,
  misc: 56,
  bass: 35,
  ambi: 81,
  vinyl: 69,
  crackle: 69,
  white: 70,
  pink: 70,
  brown: 70,
};

export function percussionNoteForSample(name: string): number {
  return SAMPLE_PERCUSSION[name.toLowerCase()] ?? 76;
}
