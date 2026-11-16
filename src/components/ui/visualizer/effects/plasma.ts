/**
 * „Plasma“: der Demoszene-Klassiker – überlagerte Sinusfelder mit Palettenrotation,
 * in niedriger Auflösung gerechnet und weich hochskaliert, mit CRT-Scanlines.
 * Die Musik treibt Tempo und Farbrotation, Bass-Kicks verzerren die Kreiswellen.
 * Darüber ein leuchtendes Oszilloskop mit der Wellenform des Master-Ausgangs.
 */
import { WAVE_LENGTH } from '../audio';
import { hex, lighten, mixRgb, rgba, type Rgb } from '../colors';
import { cyclicRamp, packRamp } from '../palette';
import type { Effect } from './types';

/** Dunkler Grundton zwischen den Spurfarben – gibt dem Plasma Tiefe und Kontrast. */
const DEEP: Rgb = [10, 8, 24];

/**
 * Plasma-Verlauf aus den Farben der spielenden Spuren: je Farbe ein dunkler, getönter
 * Übergang und die Farbe selbst. Eine einzelne Farbe bekommt zusätzlich eine helle Stufe.
 */
function plasmaRamp(colors: readonly Rgb[]): Float32Array {
  const stops = colors.flatMap((c) => [mixRgb(DEEP, c, 0.18), c]);
  if (colors.length === 1) stops.push(lighten(colors[0]!, 0.45));
  return cyclicRamp(stops);
}

/** Breite des Rechenpuffers in Pixeln (Höhe folgt dem Seitenverhältnis). */
const BUFFER_WIDTH = 200;

function scanlinePattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 4;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(0, 2, 1, 2);
  return ctx.createPattern(c, 'repeat');
}

export function createPlasma(): Effect {
  // Palette blendet weich zur neuen über, wenn Spuren einsetzen oder verstummen
  const palette = new Uint32Array(256);
  let current: Float32Array | null = null;
  let target: Float32Array = new Float32Array(256 * 3);
  let paletteVersion = -1;
  const buffer = document.createElement('canvas');
  const bctx = buffer.getContext('2d')!;
  let image: ImageData | null = null;
  let pixels = new Uint32Array(0);
  let W = 0;
  let H = 0;
  let width = 0;
  let height = 0;
  let phase = 0;
  let shift = 0;
  let scanlines: CanvasPattern | null = null;

  return {
    bandCount: () => 32,
    resize(w, h) {
      width = w;
      height = h;
      W = BUFFER_WIDTH;
      H = Math.max(24, Math.round((BUFFER_WIDTH * h) / Math.max(1, w)));
      buffer.width = W;
      buffer.height = H;
      image = bctx.createImageData(W, H);
      pixels = new Uint32Array(image.data.buffer);
      scanlines = null;
    },
    draw(ctx, a, colors, alpha) {
      if (!image) return;
      if (paletteVersion !== colors.version) {
        target = plasmaRamp(colors.palette);
        current ??= target.slice();
        paletteVersion = colors.version;
      }
      const blend = Math.min(1, a.dt * 2.5);
      for (let p = 0; p < target.length; p++) current![p]! += (target[p]! - current![p]!) * blend;
      packRamp(current!, palette);
      let hitLevel = 0;
      for (const v of colors.voices) hitLevel = Math.max(hitLevel, v.level);
      phase += a.dt * (0.5 + a.energy * 1.6);
      shift = (shift + a.dt * (30 + a.energy * 140) + a.pulse * 5) % 256;
      const t = phase;
      const k = 12 / W;
      const warp = 1 + a.bass * 1.2 + a.pulse * 0.6;
      const c1x = W * (0.5 + 0.35 * Math.sin(t * 0.7));
      const c1y = H * (0.5 + 0.35 * Math.cos(t * 0.9));
      const c2x = W * (0.5 + 0.4 * Math.cos(t * 0.5 + 1));
      const c2y = H * (0.5 + 0.3 * Math.sin(t * 0.6));
      let i = 0;
      for (let y = 0; y < H; y++) {
        const sy = Math.sin(y * k * 0.8 - t * 1.3);
        const dy1 = (y - c1y) ** 2;
        const dy2 = (y - c2y) ** 2;
        for (let x = 0; x < W; x++) {
          const v =
            Math.sin(x * k + t) +
            sy +
            Math.sin((x + y) * k * 0.6 + t * 0.7) +
            Math.sin(Math.sqrt((x - c1x) ** 2 + dy1) * k * 1.3 * warp - t * 2) +
            Math.sin(Math.sqrt((x - c2x) ** 2 + dy2) * k - t * 1.1);
          pixels[i++] = palette[((v * 25.6 + 128 + shift) | 0) & 255]!;
        }
      }
      bctx.putImageData(image, 0, 0);

      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = Math.min(1, alpha * (0.3 + a.pulse * 0.12 + hitLevel * 0.08));
      ctx.drawImage(buffer, 0, 0, width, height);
      // Scanlines aus dem Plasma ausstanzen (statt abzudunkeln) – der Hintergrund bleibt unberührt
      scanlines ??= scanlinePattern(ctx);
      if (scanlines) {
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = scanlines;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
      }

      // Oszilloskop: breiter, schwacher Schein in der Farbe dessen, was gerade anschlägt,
      // darüber eine dünne helle Linie
      const cy = height * 0.5;
      const amp = height * 0.18 * (1 + a.pulse * 0.3);
      const step = 2;
      const dx = width / (WAVE_LENGTH / step - 1);
      ctx.beginPath();
      for (let s = 0, x = 0; s < WAVE_LENGTH; s += step, x += dx) {
        const y = cy - Math.max(-1, Math.min(1, a.wave[s]! * 1.6)) * amp;
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineJoin = 'round';
      ctx.globalAlpha = alpha * (0.22 + hitLevel * 0.15);
      ctx.strokeStyle = rgba(colors.mix);
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.8;
      ctx.strokeStyle = hex(lighten(colors.mix, 0.75));
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
  };
}
