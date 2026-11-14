import { describe, expect, it } from 'vitest';
import type { Arrangement } from '../../../../types/ast';
import { cyclesBefore, playOrder, songPosition, startIndex } from '../arrangement';

const base: Arrangement = {
  sections: [
    { id: 'intro', cycles: 4 },
    { id: 'verse', cycles: 8 },
    { id: 'drop', cycles: 16 },
  ],
  cells: {},
  loopSection: null,
};

describe('songPosition', () => {
  it('ohne Startabschnitt: Zyklus mod Gesamtlänge', () => {
    expect(songPosition(0, base)).toEqual({ index: 0, frac: 0 });
    expect(songPosition(6, base)).toEqual({ index: 1, frac: 2 / 8 });
    expect(songPosition(28 + 13, base)).toEqual({ index: 2, frac: 1 / 16 });
  });

  it('mit Startabschnitt: Zyklus 0 = Beginn des Startabschnitts, danach der Anfang', () => {
    const arr = { ...base, startSection: 'drop' };
    expect(startIndex(arr)).toBe(2);
    expect(playOrder(arr)).toEqual([2, 0, 1]);
    expect(songPosition(0, arr)).toEqual({ index: 2, frac: 0 });
    expect(songPosition(8, arr)).toEqual({ index: 2, frac: 0.5 });
    expect(songPosition(16, arr)).toEqual({ index: 0, frac: 0 });
    expect(songPosition(22, arr)).toEqual({ index: 1, frac: 2 / 8 });
    // wickelt nach der Gesamtlänge wieder auf den Startabschnitt
    expect(songPosition(28, arr)).toEqual({ index: 2, frac: 0 });
  });

  it('Schleife hat Vorrang und läuft innerhalb des Abschnitts', () => {
    const arr = { ...base, startSection: 'drop', loopSection: 'verse' };
    expect(songPosition(10, arr)).toEqual({ index: 1, frac: 2 / 8 });
  });

  it('unbekannter Startabschnitt = von vorn; Takte davor', () => {
    expect(playOrder({ ...base, startSection: 'gone' })).toEqual([0, 1, 2]);
    expect(cyclesBefore(base, 2)).toBe(12);
    expect(songPosition(0, { ...base, sections: [] })).toBeNull();
  });
});
