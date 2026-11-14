import { describe, expect, it } from 'vitest';
import { MidiParseError, collectNotes, parseMidi, writeMidi, type MidiFile } from '../smf';

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function file(format: number, division: number, tracks: number[][]): Uint8Array {
  return Uint8Array.from([
    ...ascii('MThd'),
    ...u32(6),
    0,
    format,
    0,
    tracks.length,
    (division >> 8) & 0xff,
    division & 0xff,
    ...tracks.flatMap((t) => [...ascii('MTrk'), ...u32(t.length), ...t]),
  ]);
}

describe('SMF-Parser', () => {
  it('liest Format 0 mit Running Status, Velocity-0-Note-Off und Meta-Events', () => {
    const track = [
      0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // Tempo 500000 µs = 120 BPM
      0x00, 0xff, 0x58, 0x04, 0x03, 0x02, 0x18, 0x08, // 3/4
      0x00, 0xff, 0x03, 0x04, ...ascii('Lead'),
      0x00, 0xc0, 0x05, // Programm 5
      0x00, 0x90, 0x3c, 0x64, // C4 an
      0x60, 0x3e, 0x50, // Running Status: D4 an (Δ 96)
      0x60, 0x3c, 0x00, // Running Status, Velocity 0 = C4 aus
      0x00, 0x3e, 0x00, // D4 aus
      0x81, 0x00, 0xff, 0x2f, 0x00, // Spurende nach Δ 128 (VLQ zweibytig)
    ];
    const midi = parseMidi(file(0, 96, [track]));
    expect(midi.format).toBe(0);
    expect(midi.ppq).toBe(96);
    const ev = midi.tracks[0]!.events;
    expect(ev).toContainEqual({ type: 'tempo', tick: 0, microsecondsPerQuarter: 500000 });
    expect(ev).toContainEqual({ type: 'timeSignature', tick: 0, numerator: 3, denominator: 4, clocks: 24, thirtySeconds: 8 });
    expect(ev).toContainEqual({ type: 'trackName', tick: 0, text: 'Lead' });
    expect(ev).toContainEqual({ type: 'programChange', tick: 0, channel: 0, program: 5 });
    expect(ev.filter((e) => e.type === 'noteOn' || e.type === 'noteOff').map((e) => [e.type, e.tick, 'note' in e ? e.note : 0])).toEqual([
      ['noteOn', 0, 60],
      ['noteOn', 96, 62],
      ['noteOff', 192, 60],
      ['noteOff', 192, 62],
    ]);
    expect(ev.at(-1)).toEqual({ type: 'endOfTrack', tick: 320 });
    expect(collectNotes(midi).map((n) => [n.note, n.start, n.end, n.velocity])).toEqual([
      [60, 0, 192, 100],
      [62, 96, 192, 80],
    ]);
  });

  it('liest Format 1 mit mehreren Spuren und Kanälen (Note Off 0x80)', () => {
    const conductor = [0x00, 0xff, 0x51, 0x03, 0x09, 0x27, 0xc0, 0x00, 0xff, 0x2f, 0x00]; // 600000 µs = 100 BPM
    const drums = [0x00, 0x99, 0x24, 0x7f, 0x30, 0x89, 0x24, 0x40, 0x00, 0xff, 0x2f, 0x00];
    const midi = parseMidi(file(1, 480, [conductor, drums]));
    expect(midi.format).toBe(1);
    expect(midi.tracks).toHaveLength(2);
    expect(midi.tracks[0]!.events[0]).toEqual({ type: 'tempo', tick: 0, microsecondsPerQuarter: 600000 });
    expect(collectNotes(midi)).toEqual([{ track: 1, channel: 9, note: 36, velocity: 127, start: 0, end: 48 }]);
  });

  it('lehnt SMPTE-Zeitbasis, Nicht-MIDI und leere Dateien mit eigener Fehlerart ab', () => {
    const smpte = file(1, 0xe728, [[0x00, 0xff, 0x2f, 0x00]]);
    expect(() => parseMidi(smpte)).toThrow(MidiParseError);
    try {
      parseMidi(smpte);
    } catch (err) {
      expect((err as MidiParseError).code).toBe('smpte');
    }
    expect(() => parseMidi(Uint8Array.from(ascii('hello world')))).toThrow(expect.objectContaining({ code: 'notMidi' }));
    expect(() => parseMidi(file(1, 96, []))).toThrow(expect.objectContaining({ code: 'noTracks' }));
  });

  it('überspringt fremde Chunks und behält Lesbares abgeschnittener Spuren', () => {
    const track = [0x00, 0x90, 0x3c, 0x64, 0x10, 0x80, 0x3c]; // Note Off unvollständig
    const bytes = file(0, 96, [track]);
    const withJunk = Uint8Array.from([...bytes.slice(0, 14), ...ascii('XFIH'), ...u32(2), 1, 2, ...bytes.slice(14)]);
    const midi = parseMidi(withJunk);
    expect(midi.tracks[0]!.events[0]).toMatchObject({ type: 'noteOn', note: 60 });
  });
});

describe('SMF-Writer', () => {
  const sample: MidiFile = {
    format: 1,
    ppq: 480,
    tracks: [
      {
        events: [
          { type: 'trackName', tick: 0, text: 'Tempo & Ü' },
          { type: 'timeSignature', tick: 0, numerator: 4, denominator: 4, clocks: 24, thirtySeconds: 8 },
          { type: 'tempo', tick: 0, microsecondsPerQuarter: 468750 },
          { type: 'endOfTrack', tick: 1920 },
        ],
      },
      {
        events: [
          { type: 'trackName', tick: 0, text: 'Bass' },
          { type: 'programChange', tick: 0, channel: 2, program: 38 },
          { type: 'noteOff', tick: 480, channel: 2, note: 40, velocity: 64 },
          { type: 'noteOn', tick: 0, channel: 2, note: 40, velocity: 100 },
          { type: 'noteOn', tick: 480, channel: 2, note: 40, velocity: 90 }, // gleicher Tick: Off vor On
          { type: 'noteOff', tick: 200_000, channel: 2, note: 40, velocity: 64 }, // großes Delta (VLQ 3 Byte)
          { type: 'controller', tick: 10, channel: 2, controller: 7, value: 99 },
          { type: 'channel', tick: 20, status: 0xe2, data: [0, 64] },
          { type: 'endOfTrack', tick: 200_000 },
        ],
      },
    ],
  };

  it('Rundreise schreiben → lesen ergibt dieselben Ereignisse (mit und ohne Running Status)', () => {
    for (const runningStatus of [true, false]) {
      const parsed = parseMidi(writeMidi(sample, { runningStatus }));
      expect(parsed.format).toBe(1);
      expect(parsed.ppq).toBe(480);
      const sortKey = (e: { tick: number; type: string }) => `${String(e.tick).padStart(8, '0')}:${e.type}`;
      for (let i = 0; i < 2; i++) {
        const a = [...parsed.tracks[i]!.events].sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
        const b = [...sample.tracks[i]!.events].sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
        expect(a).toEqual(b);
      }
    }
    expect(writeMidi(sample, { runningStatus: true }).length).toBeLessThan(writeMidi(sample, { runningStatus: false }).length);
  });

  it('Note Off steht bei gleichem Tick vor Note On (Wiederanschlag)', () => {
    const notes = collectNotes(parseMidi(writeMidi(sample)));
    expect(notes.map((n) => [n.start, n.end, n.velocity])).toEqual([
      [0, 480, 100],
      [480, 200_000, 90],
    ]);
  });

  it('Format 0 braucht genau eine Spur', () => {
    expect(() => writeMidi({ format: 0, ppq: 96, tracks: [] })).toThrow();
    const one = writeMidi({ format: 0, ppq: 96, tracks: [{ events: [{ type: 'noteOn', tick: 0, channel: 0, note: 60, velocity: 1 }, { type: 'noteOff', tick: 96, channel: 0, note: 60, velocity: 0 }] }] });
    const parsed = parseMidi(one);
    expect(parsed.format).toBe(0);
    expect(collectNotes(parsed)).toHaveLength(1);
  });
});
