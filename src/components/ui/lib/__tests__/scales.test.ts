import { describe, expect, it } from 'vitest';
import { degreeName } from '../scales';

const names = (root: string, scale: string, octave: number, n = 8) =>
  Array.from({ length: n }, (_, d) => degreeName(d, root, scale, octave));

describe('degreeName – Schreibweise der Tonart', () => {
  it('Eb-Moll mit b, Cb als B', () => {
    expect(names('Eb', 'minor', 3)).toEqual(['Eb3', 'F3', 'Gb3', 'Ab3', 'Bb3', 'B3', 'Db4', 'Eb4']);
  });
  it('Kreuz-Tonarten mit #', () => {
    expect(names('E', 'major', 4)).toEqual(['E4', 'F#4', 'G#4', 'A4', 'B4', 'C#5', 'D#5', 'E5']);
    expect(names('F#', 'minor', 3, 3)).toEqual(['F#3', 'G#3', 'A3']);
  });
  it('C-Dur, C-Moll und Oktavwechsel', () => {
    expect(names('C', 'major', 4)).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5']);
    expect(names('C', 'minor', 3, 3)).toEqual(['C3', 'D3', 'Eb3']);
  });
  it('Pentatonik nach Vorzeichen der Tonart', () => {
    expect(names('Eb', 'minor:pentatonic', 3, 5)).toEqual(['Eb3', 'Gb3', 'Ab3', 'Bb3', 'Db4']);
    expect(names('A', 'minor:pentatonic', 3, 5)).toEqual(['A3', 'C4', 'D4', 'E4', 'G4']);
  });
});
