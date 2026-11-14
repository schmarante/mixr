import { atom } from 'nanostores';
import { getSampleBlob } from '../../../store/userSamples';

/**
 * Vorhören und Wellenform für eigene Samples – mit eigenem, kleinen AudioContext,
 * unabhängig von der Strudel-Engine (läuft auch, wenn die Engine noch nicht geladen ist).
 */

let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
let current: AudioBufferSourceNode | null = null;

/** Gerade vorgehörte Datei (für den Play/Stop-Zustand der Kacheln). */
export const previewing = atom<string | null>(null);

function context(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

/** Dekodiert eine Datei (gecacht). Liefert null, wenn sie fehlt oder kein Audio ist. */
export function decodeSample(fileId: string): Promise<AudioBuffer | null> {
  let p = buffers.get(fileId);
  if (!p) {
    p = getSampleBlob(fileId).then(async (blob) => {
      if (!blob) return null;
      try {
        // OfflineAudioContext zum Dekodieren: braucht keine User-Geste
        const off = new OfflineAudioContext(1, 1, 44100);
        return await off.decodeAudioData(await blob.arrayBuffer());
      } catch {
        return null;
      }
    });
    buffers.set(fileId, p);
    // Fehlende Dateien nicht dauerhaft merken (können später nachgeliefert werden)
    void p.then((b) => {
      if (!b) buffers.delete(fileId);
    });
  }
  return p;
}

/** Spitzenwerte für eine Mini-Wellenform (0…1, `bins` Werte). */
export async function waveformPeaks(fileId: string, bins: number): Promise<number[] | null> {
  const buf = await decodeSample(fileId);
  if (!buf) return null;
  const data = buf.getChannelData(0);
  const size = Math.max(1, Math.floor(data.length / bins));
  const peaks: number[] = [];
  let max = 0;
  for (let b = 0; b < bins; b++) {
    let peak = 0;
    for (let i = b * size; i < Math.min(data.length, (b + 1) * size); i++) peak = Math.max(peak, Math.abs(data[i]!));
    peaks.push(peak);
    max = Math.max(max, peak);
  }
  return max > 0 ? peaks.map((p) => p / max) : peaks;
}

export function stopPreview(): void {
  try {
    current?.stop();
  } catch {
    // schon beendet
  }
  current = null;
  previewing.set(null);
}

/** Spielt eine Datei an (oder stoppt sie, wenn sie gerade läuft). Im Klick-Handler aufrufen. */
export async function togglePreview(fileId: string): Promise<void> {
  if (previewing.get() === fileId) {
    stopPreview();
    return;
  }
  stopPreview();
  const ac = context();
  // Entsperren synchron in der Geste, Dekodieren danach
  void ac.resume();
  previewing.set(fileId);
  const buf = await decodeSample(fileId);
  if (!buf || previewing.get() !== fileId) return;
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(ac.destination);
  src.onended = () => {
    if (current === src) {
      current = null;
      previewing.set(null);
    }
  };
  current = src;
  src.start();
}

/** Länge als „1,2 s“ (für die Kachel). */
export async function sampleDuration(fileId: string): Promise<number | null> {
  return (await decodeSample(fileId))?.duration ?? null;
}
