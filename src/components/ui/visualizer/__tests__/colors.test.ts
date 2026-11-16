import { describe, expect, it } from 'vitest';
import { bandCenters } from '../audio';
import { hex, SceneColors } from '../colors';
import { hitBumps, hitFrequency, noteToMidi } from '../profile';

const RED = [255, 0, 0] as const;
const BLUE = [0, 0, 255] as const;
const YELLOW = [251, 191, 36] as const;

function scene(bands = 32) {
  const c = new SceneColors();
  c.setBands(bands);
  c.setTracks([
    { name: 'Drums', rgb: RED },
    { name: 'Bass', rgb: BLUE },
    { name: 'Gelb', rgb: YELLOW },
  ]);
  return c;
}

const run = (c: SceneColors, seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) c.update(1 / 60);
};

describe('SceneColors', () => {
  it('ohne Anschläge: Palette aller hörbaren Spuren (ohne Duplikate)', () => {
    const c = new SceneColors();
    c.setTracks([
      { name: 'Drums', rgb: RED },
      { name: 'Bass', rgb: BLUE },
      { name: 'Hats', rgb: RED },
    ]);
    expect(c.palette).toEqual([RED, BLUE]);
  });

  it('spielt nur eine Spur, besteht die Palette nur aus ihrer Farbe und der Grundton wird ihre Farbe', () => {
    const c = scene();
    const v = c.version;
    c.hit([{ name: 'Gelb', note: 'c4', s: 'sawtooth' }]);
    run(c, 1);
    expect(c.palette).toEqual([YELLOW]);
    expect(c.version).toBeGreaterThan(v);
    expect(c.ground[0]).toBeGreaterThan(240);
    expect(c.ground[2]).toBeLessThan(60);
    // verstummt sie, kehrt die Palette zu allen hörbaren Spuren zurück
    run(c, 6);
    expect(c.palette).toHaveLength(3);
  });

  it('ein Anschlag zieht die Mischfarbe zur Spurfarbe und klingt ab', () => {
    const c = scene();
    c.hit([{ name: 'Bass', note: 'c2' }]);
    expect(c.loudest()).toBe(1);
    run(c, 1 / 6);
    expect(c.mix[2]).toBeGreaterThan(200);
    expect(c.mix[0]).toBeLessThan(60);
    run(c, 2);
    expect(c.loudest()).toBe(-1);
  });

  it('Bänder: Kick färbt die Tiefen, Hi-Hat die Höhen', () => {
    const c = scene(32);
    c.hit([
      { name: 'Drums', s: 'bd' },
      { name: 'Bass', s: 'hh' },
    ]);
    run(c, 0.5);
    expect(c.bandOwner(2)).toBe(0); // ~45 Hz → Kick (Drums, rot)
    expect(c.bandOwner(29)).toBe(1); // ~10 kHz → Hi-Hat (hier auf der „Bass“-Spur, blau)
    expect(c.bandColor(2)[0]).toBeGreaterThan(200);
    expect(c.bandColor(29)[2]).toBeGreaterThan(200);
  });

  it('Pegel bleiben beim Aktualisieren der Spurliste erhalten', () => {
    const c = new SceneColors();
    c.setTracks([{ name: 'Drums', rgb: RED }]);
    c.hit([{ name: 'Drums' }]);
    c.setTracks([
      { name: 'Drums', rgb: RED },
      { name: 'Bass', rgb: BLUE },
    ]);
    expect(c.voices[0]!.level).toBe(1);
    expect(c.voices[1]!.level).toBe(0);
  });
});

describe('Frequenz-Schätzung', () => {
  it('Notennamen und Zahlen', () => {
    expect(noteToMidi('a4')).toBe(69);
    expect(noteToMidi('c3')).toBe(48);
    expect(noteToMidi('eb4')).toBe(63);
    expect(noteToMidi('f#2')).toBe(42);
    expect(noteToMidi('c')).toBe(48);
    expect(noteToMidi(60)).toBe(60);
    expect(noteToMidi('x')).toBeNull();
  });

  it('freq > note > Synth-n; Samples ohne Note haben keine Tonhöhe', () => {
    expect(hitFrequency({ name: 'x', freq: 220, note: 'c4' })).toBe(220);
    expect(hitFrequency({ name: 'x', note: 'a4' })).toBeCloseTo(440);
    expect(hitFrequency({ name: 'x', s: 'sawtooth', n: 0 })).toBeCloseTo(130.8, 0);
    expect(hitFrequency({ name: 'x', s: 'bd', n: 3 })).toBeNull();
  });

  it('Drum-Profile nach Name, Unbekanntes ohne Profil', () => {
    expect(hitBumps({ name: 'x', s: 'bd' })![0]![0]).toBeLessThan(100);
    expect(hitBumps({ name: 'x', s: 'hh' })![0]![0]).toBeGreaterThan(5000);
    expect(hitBumps({ name: 'x', s: '808_Kick_Long' })).not.toBeNull();
    expect(hitBumps({ name: 'x', s: 'meinsample' })).toBeNull();
  });

  it('Bandmitten steigen logarithmisch', () => {
    const c = bandCenters(10);
    expect(c[0]).toBeGreaterThan(30);
    expect(c[9]).toBeLessThan(16_000);
    expect(c[5]! / c[4]!).toBeCloseTo(c[1]! / c[0]!, 5);
  });
});

describe('hex', () => {
  it('rundet und begrenzt', () => {
    expect(hex([255.4, -3, 16])).toBe('#ff0010');
  });
});
