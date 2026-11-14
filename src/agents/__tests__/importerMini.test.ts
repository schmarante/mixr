import { describe, expect, it } from 'vitest';
import * as strudelMini from '@strudel/mini';
import { bjorklund, miniAtoms, miniCycles } from '../importer/mini';
import './strudelHarness'; // lädt @strudel/core (für @strudel/mini)

/**
 * Der Importer wertet Mini-Notation mit einem eigenen, kleinen Nachbau aus
 * (SSR-sicher, ohne @strudel/core). Hier wird er gegen echtes Strudel geprüft.
 */

interface RawHap {
  whole: { begin: { valueOf(): number }; end: { valueOf(): number } };
  value: unknown;
  hasOnset(): boolean;
}

function strudelEvents(text: string, cycles: number): string[][] {
  const pat = (strudelMini as { mini: (s: string) => { queryArc(a: number, b: number): RawHap[] } }).mini(text);
  return Array.from({ length: cycles }, (_, c) =>
    pat
      .queryArc(c, c + 1)
      .filter((h) => h.hasOnset())
      .map((h) => `${round(h.whole.begin.valueOf() - c)}-${round(h.whole.end.valueOf() - c)} ${JSON.stringify(h.value)}`)
      .sort(),
  );
}

function ourEvents(text: string, cycles: number): string[][] | null {
  const res = miniCycles(text, cycles);
  return res && res.map((evs) => evs.map((e) => `${round(e.begin.valueOf())}-${round(e.end.valueOf())} ${JSON.stringify(e.value)}`).sort());
}

const round = (x: number) => Math.round(x * 1e9) / 1e9;

const SUPPORTED = [
  'bd sd',
  'bd*4, [~ sd]*2, [~ hh]*4',
  'bd ~ ~ bd ~ ~ bd ~',
  'bd [~ bd] ~ <sd cp>',
  '<bd sd>*4',
  '<bd sd cp>',
  '<bd [sd sd]> hh',
  'bd(3,8)',
  'bd(3,8,2) hh(5,8)',
  'bd(-3,8)',
  'hh!3 sd',
  'bd! ~ sd!',
  'bd@3 sd',
  'bd _ _ sd',
  'bd:3 sd:0',
  'bd/2 sd',
  'bd*1.5',
  '[bd sd]/1.5',
  '{bd sd, hh hh hh}',
  '{bd sd hh}%4',
  'bd . sd sd . hh hh hh',
  '0 2 4 [5,7]',
  '<0 3> 2 4 [5 7]',
  '<[0 2] 4>!2 7',
  '[0 1 2]*<2>',
  '<bd sd, hh hh hh>',
  '- bd ~ sd',
];

describe('Mini-Notation-Nachbau = echtes Strudel', () => {
  for (const text of SUPPORTED) {
    it(`"${text}"`, () => {
      const ours = ourEvents(text, 12);
      expect(ours, 'sollte unterstützt sein').not.toBeNull();
      expect(ours).toEqual(strudelEvents(text, 12));
    });
  }

  it('Zufall, Bereiche und gemusterte Argumente → nicht unterstützt (null)', () => {
    for (const text of ['bd? sd', 'bd | sd', '0 .. 3', 'bd*<2 3>', 'bd(<3 5>,8)']) expect(miniCycles(text, 4), text).toBeNull();
  });

  it('Syntaxfehler → null', () => {
    expect(miniCycles('bd [sd', 2)).toBeNull();
  });

  it('bjorklund wie Strudel', () => {
    expect(bjorklund(3, 8)).toEqual([1, 0, 0, 1, 0, 0, 1, 0]);
    expect(bjorklund(5, 8)).toEqual([1, 0, 1, 1, 0, 1, 1, 0]);
  });

  it('Atome mit Position (für die Klang-Ersetzung)', () => {
    const text = 'bd*2 [~ gm_piano:3] <hh oh>';
    const atoms = miniAtoms(text)!;
    for (const a of atoms) expect(text.slice(a.start, a.end)).toBe(a.source);
    expect(atoms.map((a) => a.source)).toEqual(expect.arrayContaining(['bd', '2', 'gm_piano', '3', 'hh', 'oh']));
  });
});
