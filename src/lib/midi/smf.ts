/**
 * Standard MIDI File (SMF) – kleiner, abhängigkeitsfreier Leser und Schreiber.
 *
 * Unterstützt: Format 0, 1 (und 2 lesend), Zeitbasis in Ticks pro Viertel (PPQ),
 * Running Status (lesen und schreiben), Note On/Off (Note On mit Velocity 0 = Note Off),
 * alle übrigen Kanal-Nachrichten (Programmwechsel, Controller, Pitch Bend …),
 * Meta-Events (Tempo, Taktart, Spurname, Spurende; andere roh), SysEx.
 * SMPTE-Zeitbasis wird mit einer eigenen Fehlerart abgelehnt.
 *
 * Alle Zeitangaben sind absolute Ticks (nicht Delta-Zeiten).
 * Reine Funktionen ohne Browser-APIs (Node/SSR-sicher).
 */

export type MidiEvent =
  | { type: 'noteOn'; tick: number; channel: number; note: number; velocity: number }
  | { type: 'noteOff'; tick: number; channel: number; note: number; velocity: number }
  | { type: 'programChange'; tick: number; channel: number; program: number }
  | { type: 'controller'; tick: number; channel: number; controller: number; value: number }
  /** Übrige Kanal-Nachrichten (Aftertouch, Pitch Bend …), Status inkl. Kanal. */
  | { type: 'channel'; tick: number; status: number; data: number[] }
  | { type: 'tempo'; tick: number; microsecondsPerQuarter: number }
  | { type: 'timeSignature'; tick: number; numerator: number; denominator: number; clocks: number; thirtySeconds: number }
  | { type: 'trackName'; tick: number; text: string }
  | { type: 'endOfTrack'; tick: number }
  /** Andere Meta-Events (Text, Copyright, Tonart …) roh. */
  | { type: 'meta'; tick: number; metaType: number; data: Uint8Array }
  | { type: 'sysex'; tick: number; status: number; data: Uint8Array };

export interface MidiTrack {
  events: MidiEvent[];
}

export interface MidiFile {
  format: 0 | 1 | 2;
  /** Ticks pro Viertelnote. */
  ppq: number;
  tracks: MidiTrack[];
}

export type MidiErrorCode = 'notMidi' | 'smpte' | 'truncated' | 'noTracks';

/** Datei ist kein lesbares SMF – `code` für eine übersetzbare Meldung. */
export class MidiParseError extends Error {
  constructor(
    readonly code: MidiErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'MidiParseError';
  }
}

/* ------------------------------------------------------------------ */
/* Lesen                                                               */
/* ------------------------------------------------------------------ */

class Reader {
  pos: number;
  constructor(
    readonly bytes: Uint8Array,
    start: number,
    readonly end: number,
  ) {
    this.pos = start;
  }
  get done(): boolean {
    return this.pos >= this.end;
  }
  u8(): number {
    if (this.pos >= this.end) throw new MidiParseError('truncated');
    return this.bytes[this.pos++]!;
  }
  u16(): number {
    return (this.u8() << 8) | this.u8();
  }
  u32(): number {
    return ((this.u8() << 24) >>> 0) + (this.u8() << 16) + (this.u8() << 8) + this.u8();
  }
  vlq(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      value = value * 128 + (b & 0x7f);
      if ((b & 0x80) === 0) return value;
    }
    throw new MidiParseError('truncated', 'variable-length quantity too long');
  }
  take(n: number): Uint8Array {
    if (this.pos + n > this.end) throw new MidiParseError('truncated');
    const out = this.bytes.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  ascii(n: number): string {
    return String.fromCharCode(...this.take(n));
  }
}

/** Datenbytes je Kanal-Nachricht (nach Status-Nibble). */
function dataLength(status: number): number {
  const kind = status & 0xf0;
  return kind === 0xc0 || kind === 0xd0 ? 1 : 2;
}

function decodeText(data: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return String.fromCharCode(...data); // Latin-1
  }
}

/** Sucht den MThd-Kopf (auch in RIFF-RMID-Hüllen). */
function headerOffset(bytes: Uint8Array): number {
  const isAt = (i: number) => bytes[i] === 0x4d && bytes[i + 1] === 0x54 && bytes[i + 2] === 0x68 && bytes[i + 3] === 0x64;
  if (isAt(0)) return 0;
  const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  if (riff) {
    for (let i = 4; i < Math.min(bytes.length - 4, 256); i++) if (isAt(i)) return i;
  }
  return -1;
}

function parseTrack(r: Reader): MidiTrack {
  const events: MidiEvent[] = [];
  try {
    readEvents(r, events);
  } catch (err) {
    // Abgeschnittene Spur (häufig bei Dateien aus dem Netz): Lesbares behalten
    if (!(err instanceof MidiParseError) || events.length === 0) throw err;
  }
  return { events };
}

function readEvents(r: Reader, events: MidiEvent[]): void {
  let tick = 0;
  let running = 0;
  while (!r.done) {
    tick += r.vlq();
    let status = r.bytes[r.pos]!;
    if (status < 0x80) {
      // Running Status: Datenbyte ohne Status → letzter Kanal-Status gilt weiter
      if (running === 0) throw new MidiParseError('truncated', 'data byte without status');
      status = running;
    } else {
      r.pos++;
    }
    if (status === 0xff) {
      running = 0;
      const metaType = r.u8();
      const data = r.take(r.vlq());
      if (metaType === 0x2f) {
        events.push({ type: 'endOfTrack', tick });
        break;
      }
      if (metaType === 0x51 && data.length === 3) {
        events.push({ type: 'tempo', tick, microsecondsPerQuarter: (data[0]! << 16) | (data[1]! << 8) | data[2]! });
      } else if (metaType === 0x58 && data.length >= 2) {
        events.push({
          type: 'timeSignature',
          tick,
          numerator: data[0]!,
          denominator: 2 ** data[1]!,
          clocks: data[2] ?? 24,
          thirtySeconds: data[3] ?? 8,
        });
      } else if (metaType === 0x03) {
        events.push({ type: 'trackName', tick, text: decodeText(data) });
      } else {
        events.push({ type: 'meta', tick, metaType, data });
      }
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      running = 0;
      events.push({ type: 'sysex', tick, status, data: r.take(r.vlq()) });
      continue;
    }
    if (status >= 0xf0) {
      // System-Common/Realtime haben in Dateien nichts verloren (ohne Länge nicht lesbar)
      throw new MidiParseError('truncated', `unexpected status 0x${status.toString(16)}`);
    }
    running = status;
    const channel = status & 0x0f;
    const kind = status & 0xf0;
    const a = r.u8() & 0x7f;
    const b = dataLength(status) === 2 ? r.u8() & 0x7f : 0;
    if (kind === 0x90 && b > 0) events.push({ type: 'noteOn', tick, channel, note: a, velocity: b });
    else if (kind === 0x90 || kind === 0x80) events.push({ type: 'noteOff', tick, channel, note: a, velocity: kind === 0x80 ? b : 64 });
    else if (kind === 0xc0) events.push({ type: 'programChange', tick, channel, program: a });
    else if (kind === 0xb0) events.push({ type: 'controller', tick, channel, controller: a, value: b });
    else events.push({ type: 'channel', tick, status, data: dataLength(status) === 2 ? [a, b] : [a] });
  }
}

/**
 * Liest ein Standard MIDI File.
 * @throws MidiParseError – kein MIDI, SMPTE-Zeitbasis, abgeschnittene Datei
 */
export function parseMidi(bytes: Uint8Array): MidiFile {
  const start = headerOffset(bytes);
  if (start < 0) throw new MidiParseError('notMidi');
  const head = new Reader(bytes, start, bytes.length);
  head.ascii(4); // MThd
  const headerLength = head.u32();
  if (headerLength < 6) throw new MidiParseError('notMidi', 'header too short');
  const format = head.u16();
  const trackCount = head.u16();
  const division = head.u16();
  head.pos = start + 8 + headerLength;
  if (format > 2) throw new MidiParseError('notMidi', `format ${format}`);
  if (division & 0x8000) throw new MidiParseError('smpte');
  if (division === 0) throw new MidiParseError('notMidi', 'division 0');

  const tracks: MidiTrack[] = [];
  while (head.pos + 8 <= bytes.length && tracks.length < trackCount) {
    const id = head.ascii(4);
    const length = head.u32();
    const end = Math.min(head.pos + length, bytes.length);
    if (id === 'MTrk') {
      tracks.push(parseTrack(new Reader(bytes, head.pos, end)));
    }
    head.pos = end; // unbekannte Chunks überspringen
  }
  if (tracks.length === 0) throw new MidiParseError('noTracks');
  return { format: format as 0 | 1 | 2, ppq: division, tracks };
}

/* ------------------------------------------------------------------ */
/* Schreiben                                                           */
/* ------------------------------------------------------------------ */

class Writer {
  private chunks: number[] = [];
  u8(v: number) {
    this.chunks.push(v & 0xff);
  }
  u16(v: number) {
    this.u8(v >> 8);
    this.u8(v);
  }
  u32(v: number) {
    this.u8(v >>> 24);
    this.u8(v >>> 16);
    this.u8(v >>> 8);
    this.u8(v);
  }
  vlq(v: number) {
    let value = Math.max(0, Math.round(v));
    const bytes = [value & 0x7f];
    while ((value = Math.floor(value / 128)) > 0) bytes.unshift((value & 0x7f) | 0x80);
    for (const b of bytes) this.u8(b);
  }
  bytes(data: ArrayLike<number>) {
    for (let i = 0; i < data.length; i++) this.u8(data[i]!);
  }
  ascii(s: string) {
    for (const ch of s) this.u8(ch.charCodeAt(0));
  }
  get length() {
    return this.chunks.length;
  }
  toArray(): number[] {
    return this.chunks;
  }
}

const clamp7 = (v: number) => Math.max(0, Math.min(127, Math.round(v)));

/** Reihenfolge bei gleichem Tick: Meta/Programm vor Note Off vor Note On, Spurende zuletzt. */
function eventOrder(e: MidiEvent): number {
  switch (e.type) {
    case 'trackName':
    case 'tempo':
    case 'timeSignature':
    case 'meta':
    case 'sysex':
      return 0;
    case 'programChange':
    case 'controller':
    case 'channel':
      return 1;
    case 'noteOff':
      return 2;
    case 'noteOn':
      return 3;
    case 'endOfTrack':
      return 4;
  }
}

function writeTrack(track: MidiTrack, runningStatus: boolean): number[] {
  const w = new Writer();
  const events = track.events
    .filter((e) => e.type !== 'endOfTrack')
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.tick - b.e.tick || eventOrder(a.e) - eventOrder(b.e) || a.i - b.i)
    .map((x) => x.e);
  const lastTick = Math.max(0, ...track.events.map((e) => e.tick));
  let tick = 0;
  let running = -1;
  const channelMsg = (status: number, data: number[]) => {
    if (!runningStatus || status !== running) w.u8(status);
    running = status;
    for (const d of data) w.u8(clamp7(d));
  };
  for (const e of events) {
    const t = Math.max(tick, Math.round(e.tick));
    w.vlq(t - tick);
    tick = t;
    switch (e.type) {
      case 'noteOn':
        channelMsg(0x90 | (e.channel & 0x0f), [e.note, Math.max(1, Math.min(127, e.velocity))]);
        break;
      case 'noteOff':
        // Mit Running Status als Note On + Velocity 0 (üblich, spart das Status-Byte);
        // die Release-Velocity geht dabei verloren (Leser: 64).
        if (runningStatus) channelMsg(0x90 | (e.channel & 0x0f), [e.note, 0]);
        else channelMsg(0x80 | (e.channel & 0x0f), [e.note, e.velocity]);
        break;
      case 'programChange':
        channelMsg(0xc0 | (e.channel & 0x0f), [e.program]);
        break;
      case 'controller':
        channelMsg(0xb0 | (e.channel & 0x0f), [e.controller, e.value]);
        break;
      case 'channel':
        channelMsg(e.status, e.data);
        break;
      case 'tempo': {
        running = -1;
        const us = Math.max(1, Math.min(0xffffff, Math.round(e.microsecondsPerQuarter)));
        w.bytes([0xff, 0x51, 0x03, us >> 16, (us >> 8) & 0xff, us & 0xff]);
        break;
      }
      case 'timeSignature':
        running = -1;
        w.bytes([0xff, 0x58, 0x04, e.numerator, Math.round(Math.log2(e.denominator)), e.clocks, e.thirtySeconds]);
        break;
      case 'trackName': {
        running = -1;
        const data = new TextEncoder().encode(e.text);
        w.bytes([0xff, 0x03]);
        w.vlq(data.length);
        w.bytes(data);
        break;
      }
      case 'meta':
        running = -1;
        w.bytes([0xff, e.metaType]);
        w.vlq(e.data.length);
        w.bytes(e.data);
        break;
      case 'sysex':
        running = -1;
        w.u8(e.status);
        w.vlq(e.data.length);
        w.bytes(e.data);
        break;
    }
  }
  const endTick = Math.max(tick, Math.round(track.events.find((e) => e.type === 'endOfTrack')?.tick ?? lastTick));
  w.vlq(endTick - tick);
  w.bytes([0xff, 0x2f, 0x00]);
  return w.toArray();
}

/**
 * Schreibt ein Standard MIDI File. Ereignisse dürfen unsortiert sein; das Spurende
 * wird ergänzt (am letzten Ereignis bzw. am angegebenen `endOfTrack`).
 */
export function writeMidi(file: MidiFile, options: { runningStatus?: boolean } = {}): Uint8Array {
  const runningStatus = options.runningStatus ?? true;
  if (file.format === 0 && file.tracks.length !== 1) throw new Error('Format 0 needs exactly one track');
  const w = new Writer();
  w.ascii('MThd');
  w.u32(6);
  w.u16(file.format);
  w.u16(file.tracks.length);
  w.u16(Math.max(1, Math.min(0x7fff, Math.round(file.ppq))));
  for (const track of file.tracks) {
    const data = writeTrack(track, runningStatus);
    w.ascii('MTrk');
    w.u32(data.length);
    w.bytes(data);
  }
  return Uint8Array.from(w.toArray());
}

/* ------------------------------------------------------------------ */
/* Hilfen                                                              */
/* ------------------------------------------------------------------ */

/** Gepaarte Note (Start/Ende in Ticks). */
export interface MidiNote {
  track: number;
  channel: number;
  note: number;
  velocity: number;
  start: number;
  end: number;
}

/**
 * Paart Note On/Off je Spur, Kanal und Tonhöhe (FIFO). Nicht beendete Noten
 * enden am Spurende.
 */
export function collectNotes(file: MidiFile): MidiNote[] {
  const out: MidiNote[] = [];
  file.tracks.forEach((track, ti) => {
    const open = new Map<number, Array<{ start: number; velocity: number }>>();
    let last = 0;
    const sorted = track.events
      .map((e, i) => ({ e, i }))
      .sort((a, b) => a.e.tick - b.e.tick || a.i - b.i)
      .map((x) => x.e);
    for (const e of sorted) {
      last = Math.max(last, e.tick);
      if (e.type === 'noteOn') {
        const key = e.channel * 128 + e.note;
        const list = open.get(key) ?? [];
        list.push({ start: e.tick, velocity: e.velocity });
        open.set(key, list);
      } else if (e.type === 'noteOff') {
        const key = e.channel * 128 + e.note;
        const started = open.get(key)?.shift();
        if (started) out.push({ track: ti, channel: e.channel, note: e.note, velocity: started.velocity, start: started.start, end: e.tick });
      }
    }
    for (const [key, list] of open) {
      for (const s of list) out.push({ track: ti, channel: Math.floor(key / 128), note: key % 128, velocity: s.velocity, start: s.start, end: Math.max(last, s.start) });
    }
  });
  return out.sort((a, b) => a.start - b.start || a.track - b.track || a.channel - b.channel || a.note - b.note);
}
