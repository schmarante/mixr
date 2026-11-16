import { describe, expect, it } from 'vitest';
import { AudioAnalysis, logBands, triggerIndex, WAVE_LENGTH } from '../audio';
import { cyclicPalette } from '../palette';

/** Minimaler Analyser-Ersatz: feste Spektrum-/Wellenformdaten. */
function fakeAnalyser(freq: (bin: number) => number, wave: (i: number) => number = () => 0): AnalyserNode {
  const fftSize = 2048;
  return {
    fftSize,
    frequencyBinCount: fftSize / 2,
    context: { sampleRate: 48_000 },
    getByteFrequencyData: (out: Uint8Array) => out.forEach((_, i) => (out[i] = freq(i))),
    getFloatTimeDomainData: (out: Float32Array) => out.forEach((_, i) => (out[i] = wave(i))),
  } as unknown as AnalyserNode;
}

describe('logBands', () => {
  it('verteilt Bänder lückenlos aufsteigend und innerhalb der Bins', () => {
    const bands = logBands(48, 1024, 48_000);
    expect(bands).toHaveLength(48);
    for (const [lo, hi] of bands) {
      expect(lo).toBeGreaterThanOrEqual(1);
      expect(hi).toBeGreaterThan(lo);
      expect(hi).toBeLessThanOrEqual(1024);
    }
    for (let i = 1; i < bands.length; i++) expect(bands[i]![0]).toBeGreaterThanOrEqual(bands[i - 1]![0]);
  });
});

describe('triggerIndex', () => {
  it('findet die erste steigende Nullstelle', () => {
    const s = Float32Array.from([0.5, 0.2, -0.3, -0.1, 0.4, 0.8]);
    expect(triggerIndex(s, 2)).toBe(4);
  });
  it('liefert 0 ohne Flanke', () => {
    expect(triggerIndex(new Float32Array(8), 2)).toBe(0);
  });
});

describe('AudioAnalysis', () => {
  it('Bass-Anstieg erzeugt einen Kick-Puls, der wieder abklingt', () => {
    const a = new AudioAnalysis();
    a.setBandCount(32);
    const quiet = fakeAnalyser(() => 0);
    const kick = fakeAnalyser((bin) => (bin < 6 ? 255 : 0));
    for (let i = 0; i < 30; i++) a.update(quiet, 1 / 60);
    expect(a.frame.pulse).toBe(0);
    a.update(kick, 1 / 60);
    const peak = a.frame.pulse;
    expect(peak).toBeGreaterThan(0.5);
    expect(a.frame.bars[0]).toBeGreaterThan(0.5);
    for (let i = 0; i < 30; i++) a.update(kick, 1 / 60);
    expect(a.frame.pulse).toBeLessThan(peak);
  });

  it('Wellenform startet an der Trigger-Flanke', () => {
    const a = new AudioAnalysis();
    a.setBandCount(8);
    a.update(
      fakeAnalyser(
        () => 0,
        (i) => Math.sin(((i + 7) / 64) * Math.PI * 2),
      ),
      1 / 60,
    );
    expect(a.frame.wave).toHaveLength(WAVE_LENGTH);
    expect(a.frame.wave[0]).toBeGreaterThanOrEqual(0);
    expect(a.frame.wave[0]).toBeLessThan(0.15);
    expect(a.frame.wave[4]).toBeGreaterThan(a.frame.wave[0]!);
  });

  it('ohne Analyser fällt alles sanft zusammen', () => {
    const a = new AudioAnalysis();
    a.setBandCount(8);
    a.update(fakeAnalyser(() => 200), 1 / 60);
    const before = a.frame.bars[3]!;
    a.update(null, 0.05);
    expect(a.frame.bars[3]).toBeLessThan(before);
    expect(a.frame.bars[3]).toBeGreaterThan(0);
  });
});

describe('Paletten', () => {
  it('cyclicPalette beginnt mit der ersten Farbe, volle Deckkraft', () => {
    const p = cyclicPalette(['#ff0000', '#0000ff']);
    expect(p).toHaveLength(256);
    expect(p[0]! & 0xff).toBe(255); // R
    expect(p[0]! >>> 24).toBe(255); // A
  });
});
