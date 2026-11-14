/**
 * Kleine Musiktheorie-Helfer für die Piano-Roll: Skalenstufe → Notenname.
 * Nur für die Anzeige – der Compiler überlässt die Tonhöhe Strudels `scale()`.
 */

const SCALE_INTERVALS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  'minor:pentatonic': [0, 3, 5, 7, 10],
  'major:pentatonic': [0, 2, 4, 7, 9],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  'harmonic:minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic:minor': [0, 2, 3, 5, 7, 9, 11],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

const NOTE_INDEX: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

export function scaleIntervals(scale: string): number[] {
  return SCALE_INTERVALS[scale] ?? SCALE_INTERVALS['major']!;
}

/** Anzahl Stufen pro Oktave (7 bei Dur/Moll, 5 bei Pentatonik …). */
export function scaleLength(scale: string): number {
  return scaleIntervals(scale).length;
}

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_SEMIS = [0, 2, 4, 5, 7, 9, 11];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MINORISH = new Set(['minor', 'minor:pentatonic', 'dorian', 'phrygian', 'locrian', 'harmonic:minor', 'melodic:minor']);

/** b-Tonart? (für Skalen ohne 7 Stufen, bei denen die Buchstaben-Regel nicht greift) */
function prefersFlats(root: string, scale: string): boolean {
  if (root.includes('b') || root === 'F') return true;
  return MINORISH.has(scale) && ['C', 'D', 'G'].includes(root);
}

/**
 * Notenname einer Skalenstufe in der Schreibweise der Tonart, z. B.
 * degreeName(2, 'C', 'minor', 3) → "Eb3", degreeName(6, 'Eb', 'minor', 3) → "Db4".
 * Siebenstufige Skalen: jede Stufe bekommt den nächsten Buchstaben (Eb-Moll: Eb F Gb Ab Bb …).
 * Ausnahme für Einsteiger: statt Cb/Fb/E#/B# und Doppel-Vorzeichen der einfache Name (B, E, F, C).
 */
export function degreeName(degree: number, root: string, scale: string, octave: number): string {
  const iv = scaleIntervals(scale);
  const len = iv.length;
  const oct = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  const rootSemis = NOTE_INDEX[root] ?? 0;
  const semis = rootSemis + iv[idx]! + 12 * (octave + oct);
  const pc = ((semis % 12) + 12) % 12;
  const octaveNum = Math.floor(semis / 12);

  if (len === 7) {
    const letterIdx = (LETTERS.indexOf(root[0]!.toUpperCase()) + idx) % 7;
    const letter = LETTERS[letterIdx]!;
    const diff = (((pc - LETTER_SEMIS[letterIdx]!) % 12) + 18) % 12 - 6; // −6 … +5
    const spelled = diff === 0 ? letter : diff === -1 ? `${letter}b` : diff === 1 ? `${letter}#` : null;
    if (spelled && !['Cb', 'Fb', 'E#', 'B#'].includes(spelled)) return `${spelled}${octaveNum}`;
  }
  const names = prefersFlats(root, scale) ? FLAT_NAMES : SHARP_NAMES;
  return `${names[pc]}${octaveNum}`;
}

export function isRootDegree(degree: number, scale: string): boolean {
  const len = scaleLength(scale);
  return ((degree % len) + len) % len === 0;
}
