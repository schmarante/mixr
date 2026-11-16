/**
 * Audio-Analyse für die Visualizer-Effekte: logarithmisches Spektrum mit Peaks,
 * Gesamtenergie, Bass-Kick-Puls und (getriggerte) Wellenform.
 */

/** Frequenzbereich der Bänder (logarithmisch verteilt). */
const MIN_HZ = 30;
const MAX_HZ = 16_000;
const BASS_HZ: [number, number] = [35, 130];
/** Länge der Wellenform für Oszilloskope (Samples). */
export const WAVE_LENGTH = 1024;

/** Bänder [lo, hi) als FFT-Bin-Indizes, logarithmisch zwischen MIN_HZ und MAX_HZ. */
export function logBands(count: number, binCount: number, sampleRate: number): Array<[number, number]> {
  const nyquist = sampleRate / 2;
  const toBin = (hz: number) => Math.min(binCount - 1, Math.max(1, Math.round((hz / nyquist) * binCount)));
  const bands: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    const lo = toBin(MIN_HZ * (MAX_HZ / MIN_HZ) ** (i / count));
    const hi = toBin(MIN_HZ * (MAX_HZ / MIN_HZ) ** ((i + 1) / count));
    bands.push([lo, Math.max(lo + 1, hi)]);
  }
  return bands;
}

/** Mittenfrequenz (Hz, geometrisch) jedes Bandes – passend zu `logBands`. */
export function bandCenters(count: number): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = MIN_HZ * (MAX_HZ / MIN_HZ) ** ((i + 0.5) / count);
  return out;
}

/**
 * Start einer steigenden Nulldurchgangs-Flanke in der ersten Hälfte (wie der Trigger
 * eines Oszilloskops) – so steht periodisches Material ruhig statt zu zappeln.
 */
export function triggerIndex(samples: Float32Array, span: number): number {
  // letzte zulässige Startposition: ab dort passen noch `span` Samples hinein
  const limit = samples.length - span;
  for (let i = 1; i <= limit; i++) {
    if (samples[i - 1]! < 0 && samples[i]! >= 0) return i;
  }
  return 0;
}

/** Was die Effekte pro Frame bekommen. Werte 0…1, sofern nicht anders angegeben. */
export interface AudioFrame {
  /** Sekunden seit dem letzten Frame (begrenzt). */
  dt: number;
  /** Laufende Zeit in Sekunden. */
  time: number;
  /** Spektrum (schnell steigend, langsam fallend) und Peak-Kappen. */
  bars: Float32Array;
  peaks: Float32Array;
  /** Mittlerer Pegel aller Bänder (geglättet). */
  energy: number;
  /** Kick-Impuls: springt bei Bass-Anstieg hoch und klingt schnell ab. */
  pulse: number;
  /** Bass-Pegel. */
  bass: number;
  /** Wellenform −1…1, ab Trigger-Punkt, Länge WAVE_LENGTH. */
  wave: Float32Array;
}

export class AudioAnalysis {
  readonly frame: AudioFrame = {
    dt: 0,
    time: 0,
    bars: new Float32Array(0),
    peaks: new Float32Array(0),
    energy: 0,
    pulse: 0,
    bass: 0,
    wave: new Float32Array(WAVE_LENGTH),
  };
  private peakHold = new Float32Array(0);
  private bands: Array<[number, number]> = [];
  private bandsKey = '';
  private freq = new Uint8Array(0);
  private time = new Float32Array(0);
  private bassSlow = 0;

  /** Anzahl der Spektrumbänder (je nach Effekt bzw. Breite). */
  setBandCount(count: number): void {
    if (count === this.frame.bars.length) return;
    this.frame.bars = new Float32Array(count);
    this.frame.peaks = new Float32Array(count);
    this.peakHold = new Float32Array(count);
    this.bandsKey = '';
  }

  update(analyser: AnalyserNode | null, dt: number): void {
    const f = this.frame;
    f.dt = dt;
    f.time += dt;
    const n = f.bars.length;
    if (!analyser) {
      // ohne Signal sanft zusammenfallen
      for (let i = 0; i < n; i++) {
        f.bars[i] = Math.max(0, f.bars[i]! - dt * 1.5);
        f.peaks[i] = Math.max(0, f.peaks[i]! - dt * 0.7);
      }
      f.energy *= Math.exp(-dt * 4);
      f.pulse *= Math.exp(-dt * 6);
      f.bass *= Math.exp(-dt * 4);
      for (let i = 0; i < f.wave.length; i++) f.wave[i]! *= Math.exp(-dt * 8);
      return;
    }

    if (this.freq.length !== analyser.frequencyBinCount) this.freq = new Uint8Array(analyser.frequencyBinCount);
    if (this.time.length !== analyser.fftSize) this.time = new Float32Array(analyser.fftSize);
    analyser.getByteFrequencyData(this.freq);
    analyser.getFloatTimeDomainData(this.time);
    const freq = this.freq;
    const sampleRate = analyser.context.sampleRate;

    const key = `${n}|${freq.length}|${sampleRate}`;
    if (key !== this.bandsKey) {
      this.bands = logBands(n, freq.length, sampleRate);
      this.bandsKey = key;
    }

    let sum = 0;
    for (let i = 0; i < n; i++) {
      const [lo, hi] = this.bands[i]!;
      let v = 0;
      for (let b = lo; b < hi; b++) v = Math.max(v, freq[b]!);
      // Höhen haben weniger Pegel – leicht anheben, damit das Spektrum ausgewogen wirkt
      const level = Math.min(1, (v / 255) ** 1.6 * (1 + (i / n) * 0.6));
      sum += level;
      f.bars[i] = Math.max(level, f.bars[i]! - dt * 2.4);
      if (f.bars[i]! >= f.peaks[i]!) {
        f.peaks[i] = f.bars[i]!;
        this.peakHold[i] = 0.35;
      } else if ((this.peakHold[i]! -= dt) <= 0) {
        f.peaks[i] = Math.max(0, f.peaks[i]! - dt * 0.7);
      }
    }
    f.energy += ((n ? sum / n : 0) - f.energy) * Math.min(1, dt * 8);

    const nyquist = sampleRate / 2;
    const bLo = Math.max(1, Math.floor((BASS_HZ[0] / nyquist) * freq.length));
    const bHi = Math.max(bLo + 1, Math.ceil((BASS_HZ[1] / nyquist) * freq.length));
    let bass = 0;
    for (let b = bLo; b < bHi; b++) bass += freq[b]!;
    bass /= (bHi - bLo) * 255;
    f.bass = bass;
    // Kick = Bass deutlich über seinem gleitenden Mittel
    const flux = Math.max(0, bass - this.bassSlow);
    this.bassSlow += (bass - this.bassSlow) * Math.min(1, dt * 3);
    f.pulse = Math.max(f.pulse * Math.exp(-dt * 7), Math.min(1, flux * 4));

    const start = triggerIndex(this.time, WAVE_LENGTH);
    for (let i = 0; i < WAVE_LENGTH; i++) f.wave[i] = this.time[start + i] ?? 0;
  }
}
