/**
 * Grobe Frequenz-Schätzung eines Anschlags: In welchen Bändern des Spektrums klingt er?
 * Für Töne: Grundton plus Obertöne. Für Drums: typische Profile je Instrument
 * (Kick tief, Snare Mitte + Rauschen, Hi-Hat hoch …). Unbekanntes verteilt sich flach.
 * Damit färbt der Visualizer jedes Band in der Farbe der Spur, die dort gerade spielt.
 */
import type { TrackHit } from '../../../store/agentBus';

/** [Mittenfrequenz Hz, Breite in Oktaven, Gewicht] */
type Bump = readonly [number, number, number];

const DRUMS: Array<[RegExp, Bump[]]> = [
  [/(^|[^a-z])(bd|kick|kik|808bd)/, [[55, 0.7, 1], [3000, 1, 0.2]]],
  [/(^|[^a-z])(sd|snare|rim|rs)/, [[200, 0.6, 1], [4500, 1.2, 0.6]]],
  [/(^|[^a-z])(cp|clap)/, [[1200, 1, 1], [3500, 1, 0.6]]],
  [/(^|[^a-z])(hh|oh|ch|hat|shaker|sh)/, [[9000, 0.9, 1]]],
  [/(^|[^a-z])(cr|crash|ride|rd|cy|cymbal)/, [[6500, 1.2, 1]]],
  [/(^|[^a-z])(lt|mt|ht|tom)/, [[120, 0.7, 1], [1500, 1, 0.2]]],
  [/(^|[^a-z])(cb|cowbell|cl|clave|perc)/, [[1800, 0.8, 1]]],
];

/** Oszillatoren/Synths: `n` bzw. `note` ist eine Tonhöhe, kein Sample-Index. */
const SYNTH = /^(sawtooth|saw|square|sqr|triangle|tri|sine|sin|supersaw|pulse|white|pink|brown|fm|zzfx|bytebeat|z_)/;
const NOISE = /^(white|pink|brown|crackle)/;

const NOTE_NAMES: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** „c3“, „eb4“, „f#2“, „Cs5“ → MIDI; Zahl bleibt Zahl. Ohne Oktave: 3. */
export function noteToMidi(note: number | string): number | null {
  if (typeof note === 'number') return Number.isFinite(note) ? note : null;
  const m = /^([a-gA-G])([#bs]*)(-?\d+)?$/.exec(note.trim());
  if (!m) {
    const num = Number(note);
    return Number.isFinite(num) ? num : null;
  }
  let semis = NOTE_NAMES[m[1]!.toLowerCase()]!;
  for (const acc of m[2]!) semis += acc === 'b' ? -1 : 1;
  const octave = m[3] === undefined ? 3 : Number(m[3]);
  return (octave + 1) * 12 + semis;
}

const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Geschätzte Grundfrequenz eines Anschlags (null: unbekannt bzw. Drum/Geräusch). */
export function hitFrequency(hit: TrackHit): number | null {
  if (hit.freq !== undefined) return hit.freq;
  if (hit.note !== undefined) {
    const midi = noteToMidi(hit.note);
    if (midi !== null) return midiToHz(midi);
  }
  const s = (hit.s ?? '').toLowerCase();
  if (SYNTH.test(s) && !NOISE.test(s)) {
    // Synth ohne Note: n als Tonhöhe (kleine Werte relativ zu c3), sonst c3
    if (hit.n !== undefined) return midiToHz(hit.n < 24 ? 48 + hit.n : hit.n);
    return midiToHz(48);
  }
  return null;
}

/** Profil-Höcker eines Anschlags: Töne mit Obertönen, Drums nach Instrument, sonst null. */
export function hitBumps(hit: TrackHit): Bump[] | null {
  const f = hitFrequency(hit);
  if (f !== null) {
    return [
      [f, 0.35, 1],
      [f * 2, 0.35, 0.55],
      [f * 3, 0.35, 0.35],
      [f * 4, 0.35, 0.25],
    ];
  }
  const s = (hit.s ?? '').toLowerCase();
  if (NOISE.test(s)) return [[4000, 2.5, 0.8]];
  for (const [re, bumps] of DRUMS) if (re.test(s)) return bumps;
  return null;
}

/**
 * Trägt das Profil eines Anschlags in `out` ein (Maximum je Band, 0…1).
 * `centers`: Mittenfrequenzen der Bänder.
 */
export function addHitProfile(hit: TrackHit, centers: Float32Array, out: Float32Array): void {
  const bumps = hitBumps(hit);
  if (!bumps) {
    // unbekannter Klang: überall ein wenig
    for (let b = 0; b < out.length; b++) out[b] = Math.max(out[b]!, 0.3);
    return;
  }
  for (let b = 0; b < out.length; b++) {
    let v = 0;
    for (const [center, width, weight] of bumps) {
      const d = Math.log2(centers[b]! / center) / width;
      v = Math.max(v, weight * Math.exp(-d * d));
    }
    out[b] = Math.max(out[b]!, v);
  }
}
