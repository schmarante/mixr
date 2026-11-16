/**
 * Spurfarben für die Visualizer-Effekte. Je hörbarer Spur eine Stimme mit:
 * - `level`: springt bei jedem Anschlag auf 1, klingt schnell ab (Aufblitzen),
 * - `activity`: klingt langsam ab – „spielt gerade“ (die Palette besteht nur aus diesen),
 * - `profile`: in welchen Spektrum-Bändern die Spur gerade klingt (aus ihren Anschlägen geschätzt).
 * Spielt nur eine Spur, ist alles in ihrer Farbe.
 */
import type { TrackHit } from '../../../store/agentBus';
import { bandCenters } from './audio';
import { addHitProfile } from './profile';

export type Rgb = readonly [number, number, number];

export interface Voice {
  name: string;
  rgb: Rgb;
  level: number;
  activity: number;
  active: boolean;
  profile: Float32Array;
}

/** Ohne Spuren: mixr-Töne – Violett, Orange, Cyan, Pink. */
const FALLBACK: Rgb[] = [
  [167, 139, 250],
  [255, 138, 76],
  [94, 231, 255],
  [255, 95, 143],
];
/** Neutraler Grundton (Violett), wenn mehrere Farben spielen oder nichts. */
const NEUTRAL: Rgb = [104, 72, 255];

/** Ab hier gilt eine Spur als „spielt“, darunter (mit Abstand, gegen Flackern) nicht mehr. */
const ACTIVE_ON = 0.1;
const ACTIVE_OFF = 0.03;

export function rgba([r, g, b]: Rgb, a = 1): string {
  return `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${a.toFixed(3)})`;
}

export function hex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Aufhellen Richtung Weiß (0…1). */
export function lighten(c: Rgb, t: number): Rgb {
  return mixRgb(c, [255, 255, 255], t);
}

function average(colors: readonly Rgb[]): Rgb {
  const n = colors.length || 1;
  return [
    colors.reduce((s, c) => s + c[0], 0) / n,
    colors.reduce((s, c) => s + c[1], 0) / n,
    colors.reduce((s, c) => s + c[2], 0) / n,
  ];
}

function distinct(colors: readonly Rgb[]): Rgb[] {
  const seen = new Set<string>();
  return colors.filter((c) => !seen.has(c.join()) && seen.add(c.join()));
}

export interface TrackInfo {
  name: string;
  rgb: Rgb;
}

export class SceneColors {
  voices: Voice[] = [];
  /** Farben der gerade spielenden Spuren (ohne Duplikate); ersatzweise aller hörbaren bzw. Standardtöne. */
  palette: Rgb[] = FALLBACK;
  /** Mischfarbe nach Anschlag-Pegel – folgt dem, was gerade anschlägt (weich nachgeführt). */
  mix: Rgb = FALLBACK[0]!;
  /** Grundton: die Spurfarbe, wenn nur eine Farbe spielt, sonst neutrales Violett (weich nachgeführt). */
  ground: Rgb = NEUTRAL;
  /** Steigt, wenn sich die Palette ändert – Effekte bauen dann ihre Caches neu. */
  version = 0;
  private key = '';
  private paletteKey = '';
  private centers: Float32Array = new Float32Array(0);
  private bandRgb: Rgb[] = [];

  setTracks(tracks: readonly TrackInfo[]): void {
    const key = tracks.map((t) => `${t.name}|${t.rgb.join(',')}`).join(';');
    if (key === this.key) return;
    this.key = key;
    const old = new Map(this.voices.map((v) => [v.name, v]));
    const bands = this.centers.length;
    this.voices = tracks.map((t) => {
      const prev = old.get(t.name);
      return {
        name: t.name,
        rgb: t.rgb,
        level: prev?.level ?? 0,
        activity: prev?.activity ?? 0,
        active: prev?.active ?? false,
        profile: prev && prev.profile.length === bands ? prev.profile : new Float32Array(bands),
      };
    });
    this.refreshPalette();
  }

  /** Anzahl der Spektrum-Bänder (wie die Audio-Analyse des aktiven Effekts). */
  setBands(count: number): void {
    if (count === this.centers.length) return;
    this.centers = bandCenters(count);
    for (const v of this.voices) v.profile = new Float32Array(count);
    this.bandRgb = Array.from({ length: count }, () => this.mix);
  }

  hit(hits: readonly TrackHit[]): void {
    for (const h of hits) {
      const v = this.voices.find((x) => x.name === h.name);
      if (!v) continue;
      v.level = 1;
      v.activity = 1;
      if (this.centers.length) addHitProfile(h, this.centers, v.profile);
    }
  }

  update(dt: number): void {
    let w = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    const fastDecay = Math.exp(-dt * 5);
    const slowDecay = Math.exp(-dt * 0.8);
    const profileDecay = Math.exp(-dt * 1.4);
    for (const v of this.voices) {
      v.level *= fastDecay;
      v.activity *= slowDecay;
      for (let i = 0; i < v.profile.length; i++) v.profile[i]! *= profileDecay;
      if (v.activity > ACTIVE_ON) v.active = true;
      else if (v.activity < ACTIVE_OFF) v.active = false;
      const weight = v.level * v.level;
      w += weight;
      r += v.rgb[0] * weight;
      g += v.rgb[1] * weight;
      b += v.rgb[2] * weight;
    }
    this.refreshPalette();
    const ease = Math.min(1, dt * 10);
    // ohne Anschläge: Mittel der Palette
    this.mix = mixRgb(this.mix, w > 0.02 ? [r / w, g / w, b / w] : average(this.palette), ease);
    const playing = this.voices.filter((v) => v.active);
    const groundTarget = this.palette.length === 1 && playing.length ? this.palette[0]! : NEUTRAL;
    this.ground = mixRgb(this.ground, groundTarget, Math.min(1, dt * 3));
    this.updateBands(ease);
  }

  /** Spielende Stimmen; spielt (noch) keine, alle hörbaren. */
  playing(): Voice[] {
    const active = this.voices.filter((v) => v.active);
    return active.length ? active : this.voices;
  }

  /** Index der Stimme, die gerade am stärksten anschlägt (−1: keine). */
  loudest(threshold = 0.25): number {
    let best = -1;
    let level = threshold;
    this.voices.forEach((v, i) => {
      if (v.level > level) {
        level = v.level;
        best = i;
      }
    });
    return best;
  }

  /** Index der Stimme, die im Band am stärksten klingt (−1: keine). */
  bandOwner(band: number): number {
    let best = -1;
    let value = 0.05;
    this.voices.forEach((v, i) => {
      const x = (v.profile[band] ?? 0) * (0.4 + v.activity);
      if (x > value) {
        value = x;
        best = i;
      }
    });
    return best;
  }

  /** Farbe eines Spektrum-Bandes: die der Spur(en), die dort gerade klingen. */
  bandColor(band: number): Rgb {
    return this.bandRgb[band] ?? this.mix;
  }

  private updateBands(ease: number): void {
    for (let i = 0; i < this.bandRgb.length; i++) {
      let w = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (const v of this.voices) {
        // 4. Potenz: die stärkste Spur bekommt das Band klar, nur echte Gleichstände mischen
        const x = (v.profile[i] ?? 0) * (0.4 + v.activity);
        const x2 = x * x;
        const weight = x2 * x2;
        w += weight;
        r += v.rgb[0] * weight;
        g += v.rgb[1] * weight;
        b += v.rgb[2] * weight;
      }
      const target: Rgb = w > 1e-4 ? [r / w, g / w, b / w] : this.mix;
      this.bandRgb[i] = mixRgb(this.bandRgb[i]!, target, ease);
    }
  }

  private refreshPalette(): void {
    const playing = distinct(this.voices.filter((v) => v.active).map((v) => v.rgb));
    const palette = playing.length ? playing : this.voices.length ? distinct(this.voices.map((v) => v.rgb)) : FALLBACK;
    const key = palette.map((c) => c.join()).join(';');
    if (key === this.paletteKey) return;
    this.paletteKey = key;
    this.palette = palette;
    this.version++;
  }
}
