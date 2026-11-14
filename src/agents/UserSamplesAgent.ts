/**
 * UserSamples-Agent: macht die eigenen Sample-Slots für die Engine hörbar.
 *
 * - Abonniert Slots (Projekt) und vorhandene Audiodaten (IndexedDB), erzeugt Blob-URLs
 *   und registriert sie per `samples({ name: [url0, url1, …] })` aus @strudel/web –
 *   dieselbe Modulinstanz wie die Engine (`@strudel/web/web.mjs`, dynamisch, erst wenn
 *   es Slots gibt). `s("name:1")` spielt dann die zweite Datei des Slots.
 * - Bei Änderungen wird neu registriert; nicht mehr benutzte Blob-URLs werden freigegeben.
 * - Meldet eingebaute Klangnamen an den Namens-Check (Slots dürfen sie nicht überdecken).
 * - Räumt beim Start Audiodaten auf, die kein Slot mehr nutzt.
 */
import {
  cachedSampleBlob,
  collectUnusedSampleBlobs,
  getSampleBlob,
  refreshSampleBlobs,
  reserveSoundNames,
  sampleBlobs,
  sampleSlots,
} from '../store/userSamples';

type StrudelWeb = typeof import('@strudel/web');

let started = false;
let modPromise: Promise<StrudelWeb> | null = null;
/** Datei-ID → Blob-URL (wiederverwendet, solange die Datei im Projekt ist). */
const urls = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> = Promise.resolve();

function engineModule(): Promise<StrudelWeb> {
  modPromise ??= import('@strudel/web/web.mjs').then((mod: StrudelWeb) => {
    // Eingebaute Klänge (soweit schon registriert) für den Namens-Check merken
    const soundMap = (mod as unknown as { soundMap?: { get(): Record<string, unknown> } }).soundMap;
    const own = new Set(sampleSlots.get().map((s) => s.name));
    if (soundMap) reserveSoundNames(Object.keys(soundMap.get()).filter((n) => !own.has(n)));
    return mod;
  });
  return modPromise;
}

async function register(): Promise<void> {
  const slots = sampleSlots.get();
  const present = sampleBlobs.get();
  const wanted = new Set(slots.flatMap((s) => s.files.filter((f) => present[f.id]).map((f) => f.id)));

  // nicht mehr benutzte URLs freigeben
  for (const [id, url] of urls) {
    if (!wanted.has(id)) {
      URL.revokeObjectURL(url);
      urls.delete(id);
    }
  }
  if (wanted.size === 0) return;

  const map: Record<string, string[]> = {};
  for (const slot of slots) {
    const list: string[] = [];
    for (const f of slot.files) {
      if (!present[f.id]) continue;
      let url = urls.get(f.id);
      if (!url) {
        // frisch importierte Daten liegen im Speicher → ohne Warten registrierbar (wichtig für „Direkt abspielen“)
        const blob = cachedSampleBlob(f.id) ?? (await getSampleBlob(f.id));
        if (!blob) continue;
        url = URL.createObjectURL(blob);
        urls.set(f.id, url);
      }
      list.push(url);
    }
    if (list.length > 0) map[slot.name] = list;
  }
  if (Object.keys(map).length === 0) return;
  const mod = await engineModule();
  await mod.samples(map, '');
}

function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    running = running.then(register).catch((err: unknown) => console.warn('[samples] registering failed', err));
  }, 0);
}

/** Startet den Agenten (idempotent, nur im Browser). */
export function startUserSamplesAgent(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  void collectUnusedSampleBlobs()
    .catch(() => refreshSampleBlobs())
    .finally(() => {
      sampleSlots.listen(schedule);
      sampleBlobs.listen(schedule);
      schedule();
    });
}
