/**
 * „Warp“: Sternenfeld im Warp-Flug und unten Spektrum-Balken als LED-Segmente mit
 * Peak-Kappen. Bass-Kicks und Gesamtenergie beschleunigen die Sterne.
 *
 * Spurfarben: jeder Spektrum-Balken hat die Farbe der Spur, die in seinem
 * Frequenzbereich klingt; Sterne und Schein folgen der Mischfarbe.
 */
import type { AudioFrame } from '../audio';
import { hex, lighten, rgba, type SceneColors } from '../colors';
import type { Effect } from './types';

const STAR_COUNT = 240;

interface Star {
  x: number;
  y: number;
  z: number;
}

function newStar(z = Math.random()): Star {
  return { x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.max(0.05, z) };
}

export function createWarp(): Effect {
  const stars: Star[] = Array.from({ length: STAR_COUNT }, () => newStar());
  let width = 0;
  let height = 0;

  function glow(ctx: CanvasRenderingContext2D, a: AudioFrame, c: SceneColors, alpha: number): void {
    const r = Math.max(width, height) * 0.6;
    const g = ctx.createRadialGradient(width / 2, height, 0, width / 2, height, r);
    g.addColorStop(0, rgba(c.mix, 0.16 * alpha * (0.5 + a.pulse)));
    g.addColorStop(1, rgba(c.mix, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  function starfield(ctx: CanvasRenderingContext2D, a: AudioFrame, c: SceneColors, alpha: number): void {
    const cx = width / 2;
    const cy = height * 0.42;
    const fov = Math.max(width, height) * 0.5;
    const speed = 0.08 + a.energy * 0.35 + a.pulse * 1.1;
    const tail = Math.min(0.25, speed * 0.09);
    const tint = lighten(c.mix, 0.6);
    ctx.lineCap = 'round';
    for (const s of stars) {
      s.z -= speed * a.dt;
      const x = cx + (s.x / s.z) * fov;
      const y = cy + (s.y / s.z) * fov;
      if (s.z <= 0.02 || x < -20 || x > width + 20 || y < -20 || y > height + 20) {
        Object.assign(s, newStar(1));
        continue;
      }
      const tz = s.z + tail;
      const depth = 1 - s.z;
      ctx.strokeStyle = rgba(tint, depth * depth * 0.85 * alpha);
      ctx.lineWidth = 0.6 + depth * 1.8;
      ctx.beginPath();
      ctx.moveTo(cx + (s.x / tz) * fov, cy + (s.y / tz) * fov);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  }

  function spectrum(ctx: CanvasRenderingContext2D, a: AudioFrame, c: SceneColors, alpha: number): void {
    const n = a.bars.length;
    if (!n) return;
    const maxH = height * 0.32;
    const margin = 12;
    const gap = 3;
    const slot = (width - margin * 2) / n;
    const bw = Math.max(2, slot - gap);
    const seg = 5;
    const segGap = 2;
    for (let i = 0; i < n; i++) {
      // Farbe der Spur, die in diesem Frequenzband gerade klingt
      const color = c.bandColor(i);
      const x = margin + i * slot + gap / 2;
      const h = a.bars[i]! * maxH;
      ctx.globalAlpha = 0.55 * alpha;
      ctx.fillStyle = hex(lighten(color, 0.1 + a.bars[i]! * 0.3));
      for (let y = 0; y < h; y += seg + segGap) ctx.fillRect(x, height - y - seg, bw, Math.min(seg, h - y));
      if (a.peaks[i]! >= 0.02) {
        ctx.globalAlpha = 0.8 * alpha;
        ctx.fillStyle = hex(lighten(color, 0.75));
        ctx.fillRect(x, height - a.peaks[i]! * maxH - seg - 3, bw, 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  return {
    bandCount: (w) => Math.max(24, Math.min(96, Math.round(w / 22))),
    resize(w, h) {
      width = w;
      height = h;
    },
    draw(ctx, a, c, alpha) {
      glow(ctx, a, c, alpha);
      starfield(ctx, a, c, alpha);
      spectrum(ctx, a, c, alpha);
    },
  };
}
