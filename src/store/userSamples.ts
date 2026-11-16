import { atom, computed } from 'nanostores';
import type { UserSampleFile, UserSampleSlot } from '../types/ast';
import { setUserSamples } from './actions';
import { projectSettings } from './agentBus';

/**
 * Eigene Samples („Slots“ wie bei Shadertoy): Jeder Slot ist ein Strudel-Klang
 * (`s("name")`, Varianten `s("name:1")` …). Das Manifest gehört zum Projekt
 * (`ProjectSettings.samples`, mit Undo und localStorage-Persistenz), die Audiodaten
 * liegen als Blobs in IndexedDB (Schlüssel = Datei-ID) und reisen im Projekt-ZIP mit.
 */

/* ------------------------------------------------------------------ */
/* Namen                                                               */
/* ------------------------------------------------------------------ */

export const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.ogg', '.oga', '.opus', '.flac', '.m4a', '.aac', '.webm', '.aif', '.aiff'] as const;

export function isAudioFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Eingebaute Klangnamen, mit denen ein Slot nicht kollidieren darf (Synths, Drum-
 * Kürzel, mitgelieferte Sample-Sets). Die Engine meldet beim Laden weitere Namen
 * (`reserveSoundNames`).
 */
const BUILTIN_SOUNDS = new Set([
  'sine', 'square', 'sawtooth', 'saw', 'triangle', 'tri', 'supersaw', 'pulse', 'sbd', 'bytebeat',
  'white', 'pink', 'brown', 'crackle', 'zzfx', 'z_sine', 'z_sawtooth', 'z_triangle', 'z_square', 'z_tan', 'z_noise',
  'bd', 'sd', 'hh', 'oh', 'cp', 'rim', 'lt', 'mt', 'ht', 'cr', 'rd', 'cb', 'perc', 'sh', 'tb', 'fx', 'misc',
  'piano', 'ambi', 'bass', 'elec', 'glitch', 'tabla', 'vinyl', 'silence',
]);
const extraReserved = new Set<string>();

/** Weitere eingebaute Namen (von der Engine), die Slots nicht belegen dürfen. */
export function reserveSoundNames(names: Iterable<string>): void {
  for (const n of names) extraReserved.add(n.toLowerCase());
}

export function isReservedSound(name: string): boolean {
  return BUILTIN_SOUNDS.has(name) || extraReserved.has(name);
}

/**
 * Macht aus einem beliebigen Text (Datei-/Ordnername) einen gültigen, eindeutigen
 * Strudel-Klangnamen: klein, [a-z0-9_], nicht leer, kein eingebauter Klang,
 * nicht in `taken` – sonst mit Suffix „_2“, „_3“ …
 */
export function sanitizeSampleName(raw: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  let base = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (base === '') base = 'sample';
  if (/^\d/.test(base)) base = `s${base}`;
  base = base.slice(0, 32);
  let name = base;
  for (let i = 2; used.has(name) || isReservedSound(name); i++) name = `${base}_${i}`;
  return name;
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

/** Slots des aktuellen Projekts (Quelle: projectSettings.samples). */
export const sampleSlots = computed(projectSettings, (s) => s.samples ?? []);

/** Welche Audiodaten liegen lokal vor? Datei-ID → true. Fehlende = „fehlt“. */
export const sampleBlobs = atom<Record<string, true>>({});

export function newSampleId(prefix: 'slot' | 'file'): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/* ------------------------------------------------------------------ */
/* IndexedDB                                                           */
/* ------------------------------------------------------------------ */

const DB_NAME = 'mixr-samples';
const STORE = 'files';
let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('indexedDB unavailable'));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const req = run(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
  });
}

/** Zuletzt gespeicherte Audiodaten im Speicher – die Engine kann sie ohne IndexedDB-Umweg registrieren. */
const recentBlobs = new Map<string, Blob>();

/** Audiodaten aus dem Speicher-Cache (frisch hinzugefügt/importiert), sonst null. */
export function cachedSampleBlob(id: string): Blob | null {
  return recentBlobs.get(id) ?? null;
}

export async function putSampleBlob(id: string, blob: Blob): Promise<void> {
  recentBlobs.set(id, blob);
  await tx('readwrite', (s) => s.put(blob, id));
  sampleBlobs.set({ ...sampleBlobs.get(), [id]: true });
}

export async function getSampleBlob(id: string): Promise<Blob | null> {
  const cached = recentBlobs.get(id);
  if (cached) return cached;
  try {
    const v = await tx<unknown>('readonly', (s) => s.get(id));
    return v instanceof Blob ? v : null;
  } catch {
    return null;
  }
}

async function listSampleBlobIds(): Promise<string[]> {
  try {
    return (await tx('readonly', (s) => s.getAllKeys())).map(String);
  } catch {
    return [];
  }
}

/** Liest, welche Audiodaten vorhanden sind (beim Start und nach Importen). */
export async function refreshSampleBlobs(): Promise<void> {
  const ids = await listSampleBlobIds();
  sampleBlobs.set(Object.fromEntries(ids.map((id) => [id, true as const])));
}

/**
 * Entfernt Audiodaten, die das aktuelle Projekt nicht mehr nutzt (nur beim Start:
 * die Undo-Historie ist dann leer, nichts kann mehr darauf verweisen).
 */
export async function collectUnusedSampleBlobs(): Promise<void> {
  const used = new Set(sampleSlots.get().flatMap((s) => s.files.map((f) => f.id)));
  const ids = await listSampleBlobIds();
  await Promise.all(ids.filter((id) => !used.has(id)).map((id) => tx('readwrite', (s) => s.delete(id)).catch(() => undefined)));
  await refreshSampleBlobs();
}

/* ------------------------------------------------------------------ */
/* Reine Helfer                                                        */
/* ------------------------------------------------------------------ */

export interface IncomingAudio {
  /** Pfad relativ zum Ablageort (Ordner-Drops/ZIP), sonst nur der Dateiname. */
  path: string;
  blob: Blob;
}

/** Natürliche Sortierung („kick2“ vor „kick10“). */
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

/**
 * Gruppiert Audiodateien wie strudel.cc „import sounds“: Unterordner = Klang,
 * Dateien = Varianten (alphabetisch); Dateien direkt in einem Ordner gehören zum
 * Klang mit dessen Namen; lose Einzeldateien werden je ein Klang (Name aus Dateiname).
 */
export function groupSampleFiles<T extends { path: string }>(files: T[]): { name: string; files: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean);
    const key = parts.length >= 2 ? parts[parts.length - 2]! : `\u0000${parts[0] ?? f.path}`;
    const list = groups.get(key) ?? [];
    list.push(f);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({
      name: key.startsWith('\u0000') ? key.slice(1) : key,
      files: [...list].sort((a, b) => natural(baseName(a.path), baseName(b.path))),
    }))
    .sort((a, b) => natural(a.name, b.name));
}

/** Dateien, deren Audiodaten fehlen. */
export function missingSampleFiles(slots: UserSampleSlot[], present: Record<string, true>): { slot: UserSampleSlot; file: UserSampleFile }[] {
  return slots.flatMap((slot) => slot.files.filter((f) => !present[f.id]).map((file) => ({ slot, file })));
}

/** Für `s("name:i")`: Klangname mit Varianten-Index (0 ohne Suffix). */
export function sampleRef(name: string, index = 0): string {
  return index === 0 ? name : `${name}:${index}`;
}

/* ------------------------------------------------------------------ */
/* Aktionen (alle über setUserSamples → Undo)                          */
/* ------------------------------------------------------------------ */

function slots(): UserSampleSlot[] {
  return sampleSlots.get();
}

function fileMeta(path: string, blob: Blob): UserSampleFile {
  return { id: newSampleId('file'), fileName: baseName(path), mime: blob.type || 'application/octet-stream', size: blob.size };
}

/** Legt einen leeren Slot an. @returns Slot-ID */
export function addEmptySlot(name = 'sample'): string {
  const current = slots();
  const slot: UserSampleSlot = { id: newSampleId('slot'), name: sanitizeSampleName(name, current.map((s) => s.name)), files: [] };
  setUserSamples([...current, slot]);
  return slot.id;
}

export function renameSlot(slotId: string, raw: string): string | null {
  const current = slots();
  const slot = current.find((s) => s.id === slotId);
  if (!slot) return null;
  const name = sanitizeSampleName(raw, current.filter((s) => s.id !== slotId).map((s) => s.name));
  if (name === slot.name) return name;
  setUserSamples(current.map((s) => (s.id === slotId ? { ...s, name } : s)), `samples:rename:${slotId}`);
  return name;
}

export function removeSlot(slotId: string): void {
  setUserSamples(slots().filter((s) => s.id !== slotId));
}

export function removeSampleFile(slotId: string, fileId: string): void {
  setUserSamples(slots().map((s) => (s.id === slotId ? { ...s, files: s.files.filter((f) => f.id !== fileId) } : s)));
}

export function moveSampleFile(slotId: string, from: number, to: number): void {
  setUserSamples(
    slots().map((s) => {
      if (s.id !== slotId || to < 0 || to >= s.files.length) return s;
      const files = [...s.files];
      const [moved] = files.splice(from, 1);
      files.splice(to, 0, moved!);
      return { ...s, files };
    }),
  );
}

export interface SampleImportResult {
  /** Neu angelegte bzw. erweiterte Slots (Namen). */
  slots: string[];
  /** Fehlende Dateien, die jetzt wieder da sind. */
  relinked: number;
  /** Ignorierte Dateien (kein Audio). */
  skipped: number;
}

/**
 * Nimmt Audiodateien auf: Zuerst werden fehlende Dateien (gleicher Dateiname)
 * wieder verknüpft, der Rest landet im Ziel-Slot bzw. – gruppiert nach Ordnern –
 * in neuen Slots (gleichnamige vorhandene Slots werden ergänzt). Ein Undo-Schritt.
 */
export async function importSampleFiles(incoming: IncomingAudio[], targetSlotId?: string | null): Promise<SampleImportResult> {
  const audio = incoming.filter((f) => isAudioFileName(f.path));
  const skipped = incoming.length - audio.length;
  let current = slots().map((s) => ({ ...s, files: [...s.files] }));

  // 1. Fehlende Dateien wieder verknüpfen (Zuordnung über den Dateinamen)
  const missing = missingSampleFiles(current, sampleBlobs.get());
  const rest: IncomingAudio[] = [];
  let relinked = 0;
  for (const f of audio) {
    const name = baseName(f.path).toLowerCase();
    const hit = missing.findIndex((m) => m.file.fileName.toLowerCase() === name);
    if (hit >= 0) {
      await putSampleBlob(missing[hit]!.file.id, f.blob);
      missing.splice(hit, 1);
      relinked++;
    } else rest.push(f);
  }

  // 2. Neue Dateien speichern und zuordnen
  const touched: string[] = [];
  const target = targetSlotId ? current.find((s) => s.id === targetSlotId) : undefined;
  if (target) {
    for (const f of rest) {
      const meta = fileMeta(f.path, f.blob);
      await putSampleBlob(meta.id, f.blob);
      target.files.push(meta);
    }
    if (rest.length > 0) touched.push(target.name);
  } else {
    for (const group of groupSampleFiles(rest)) {
      const wanted = sanitizeSampleName(group.name, []);
      let slot = current.find((s) => s.name === wanted);
      if (!slot) {
        slot = { id: newSampleId('slot'), name: sanitizeSampleName(group.name, current.map((s) => s.name)), files: [] };
        current = [...current, slot];
      }
      for (const f of group.files) {
        const meta = fileMeta(f.path, f.blob);
        await putSampleBlob(meta.id, f.blob);
        slot.files.push(meta);
      }
      touched.push(slot.name);
    }
  }
  if (touched.length > 0) setUserSamples(current);
  return { slots: touched, relinked, skipped };
}
