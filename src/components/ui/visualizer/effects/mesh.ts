/**
 * „Mesh“: eine feine Wireframe-Landschaft (Dreiecksgitter), über die sich Wellen
 * ausbreiten wie auf einer Wasseroberfläche. Jeder Anschlag lässt die Mitte schwingen;
 * die Schwingung läuft als Wellenzug (Berg und Tal) nach außen und flacht dabei ab.
 * Die Wellenberge leuchten in der Farbe der Spur, die sie ausgelöst hat; in der Mitte
 * steht das Live-Spektrum (tiefe Frequenzen innen). Die Kamera kreist langsam.
 */
import type { AudioFrame } from '../audio';
import { lighten, mixRgb, rgba, type Rgb, type SceneColors } from '../colors';
import type { Effect } from './types';

/** Gitterpunkte je Kante (N×N) und halbe Kantenlänge in Welteinheiten. */
const N = 96;
const EXTENT = 2.4;
/** Radialer Verlauf der Wellen (Index 0 = Mitte = jetzt) und Ausbreitung in Schritten/s. */
const HISTORY = 200;
const WAVE_SPEED = 60;
/** Schwingfrequenz der Mitte (Hz) – bestimmt den Abstand der Wellenringe. */
const WAVE_FREQ = 2.1;
const WAVE_AMP = 0.1;
/** Spektrum belegt die Mitte bis zu diesem Radius (0…1). */
const SPECTRUM_RADIUS = 0.22;
const SPECTRUM_AMP = 0.17;
/** Höhe, ab der eine Spitze voll in ihrer Farbe leuchtet. */
const PEAK_HEIGHT = 0.08;

/** Kamera: Abstand zur Mitte, Höhe, Umlaufgeschwindigkeit (rad/s). */
const CAM_DISTANCE = 1.35;
const CAM_HEIGHT = 0.58;
const ORBIT_SPEED = 0.07;
const NEAR = 0.06;

/** Höhenstufen (0 = Grundton) und Tiefenstufen (0 = unsichtbar) für gebündelte Striche. */
const LEVELS = 6;
const DEPTHS = 4;

export function createMesh(): Effect {
  const count = N * N;
  const wx = new Float32Array(count);
  const wz = new Float32Array(count);
  const radius = new Float32Array(count);
  const grain = new Float32Array(count);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      wx[k] = (i / (N - 1)) * 2 * EXTENT - EXTENT;
      wz[k] = (j / (N - 1)) * 2 * EXTENT - EXTENT;
      radius[k] = Math.min(1, Math.hypot(wx[k]!, wz[k]!) / EXTENT);
      // leichte Unregelmäßigkeit – lebendiger, ohne die Wellen zu zerreißen
      grain[k] = 0.8 + Math.random() * 0.4;
    }
  }
  const sx = new Float32Array(count);
  const sy = new Float32Array(count);
  const visible = new Uint8Array(count);
  const level = new Uint8Array(count);
  const depth = new Uint8Array(count);
  /** Farbschlüssel je Punkt: Index der Stimme, oder `voices.length` = Mischfarbe. */
  const colorKey = new Uint8Array(count);
  const waveAmp = new Float32Array(HISTORY);
  const waveColor = new Int16Array(HISTORY).fill(-1);

  let width = 0;
  let height = 0;
  let orbit = Math.random() * Math.PI * 2;
  let travel = 0;
  let oscPhase = 0;
  let drive = 0;
  let time = 0;

  /** Wellenhöhe bei Radius r (0…1), linear interpoliert. */
  function waveAt(r: number): number {
    const p = r * (HISTORY - 1);
    const i = Math.floor(p);
    const f = p - i;
    return waveAmp[i]! * (1 - f) + (waveAmp[Math.min(HISTORY - 1, i + 1)] ?? 0) * f;
  }

  /** Neue Schwingung in der Mitte erzeugen und den Verlauf nach außen schieben. */
  function advanceWaves(a: AudioFrame, colors: SceneColors): void {
    oscPhase += a.dt * Math.PI * 2 * WAVE_FREQ;
    // Hüllkurve: Kicks stoßen an, abklingen über ~0,5 s; die Grundenergie hält leicht am Schwingen
    drive = Math.max(drive * Math.exp(-a.dt * 2.6), a.pulse, a.energy * 0.3);
    travel += a.dt * WAVE_SPEED;
    const steps = Math.min(HISTORY, Math.floor(travel));
    travel -= Math.floor(travel);
    if (steps <= 0) return;
    waveAmp.copyWithin(steps, 0, HISTORY - steps);
    waveColor.copyWithin(steps, 0, HISTORY - steps);
    const value = drive * Math.sin(oscPhase);
    const color = colors.loudest();
    for (let s = 0; s < steps; s++) {
      waveAmp[s] = value;
      waveColor[s] = color;
    }
  }

  function project(a: AudioFrame, colors: SceneColors): void {
    const camX = Math.cos(orbit) * CAM_DISTANCE;
    const camZ = Math.sin(orbit) * CAM_DISTANCE;
    // Blickrichtung zur Mitte (leicht nach unten)
    let fx = -camX;
    let fy = -CAM_HEIGHT;
    let fz = -camZ;
    const fl = Math.hypot(fx, fy, fz);
    fx /= fl;
    fy /= fl;
    fz /= fl;
    // rechts = forward × up(0,1,0); oben = rechts × forward
    let rx = -fz;
    let rz = fx;
    const rl = Math.hypot(rx, rz);
    rx /= rl;
    rz /= rl;
    const ux = -rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy;

    const fov = height * 0.95;
    const cx = width / 2;
    const cy = height * 0.5;
    const far = CAM_DISTANCE + EXTENT;
    const n = a.bars.length;
    const mixKey = colors.voices.length;
    // Welche Spur klingt in welchem Band? → Farbe des Spektrum-Hügels in der Mitte
    const owners = Array.from({ length: n }, (_, band) => colors.bandOwner(band));

    for (let k = 0; k < count; k++) {
      const r = radius[k]!;
      // Wellen flachen beim Ausbreiten ab (Energie verteilt sich auf den größeren Ring)
      const ring = waveAt(r) * WAVE_AMP * (1 / (1 + r * 2.2));
      let center = 0;
      let band = 0;
      if (r < SPECTRUM_RADIUS && n > 1) {
        const p = (r / SPECTRUM_RADIUS) * (n - 1);
        const b = Math.floor(p);
        band = Math.round(p);
        const bar = a.bars[b]! + ((a.bars[Math.min(n - 1, b + 1)] ?? 0) - a.bars[b]!) * (p - b);
        center = bar * SPECTRUM_AMP * (1 - r / SPECTRUM_RADIUS) ** 1.2;
      }
      const h = (ring + center) * grain[k]! + Math.sin(r * 34 - time * 1.4) * 0.003;

      const dx = wx[k]! - camX;
      const dy = h - CAM_HEIGHT;
      const dz = wz[k]! - camZ;
      const vz = dx * fx + dy * fy + dz * fz;
      if (vz < NEAR) {
        visible[k] = 0;
        continue;
      }
      const vx = dx * rx + dz * rz;
      const vy = dx * ux + dy * uy + dz * uz;
      sx[k] = cx + (vx / vz) * fov;
      sy[k] = cy - (vy / vz) * fov;
      visible[k] = 1;
      level[k] = Math.max(0, Math.min(LEVELS - 1, Math.floor((h / PEAK_HEIGHT) * LEVELS)));
      if (center > Math.abs(ring)) {
        const owner = owners[band] ?? -1;
        colorKey[k] = owner >= 0 ? owner : mixKey;
      } else {
        const c = waveColor[Math.min(HISTORY - 1, Math.round(r * (HISTORY - 1)))]!;
        colorKey[k] = c >= 0 && c < mixKey ? c : mixKey;
      }
      // Ferne und Rand blenden aus – keine harte Kante am Gitterende; ganz nahe Linien
      // (riesige Dreiecke direkt vor der Kamera) ebenfalls
      const fade = Math.min(1 - vz / far, (1 - r) * 4, (vz - NEAR) * 1.6);
      depth[k] = Math.max(0, Math.min(DEPTHS - 1, Math.floor(fade * DEPTHS)));
    }
  }

  return {
    bandCount: () => 32,
    resize(w, h) {
      width = w;
      height = h;
    },
    draw(ctx, a, colors, alpha) {
      time += a.dt;
      orbit += a.dt * ORBIT_SPEED;
      advanceWaves(a, colors);
      project(a, colors);

      // Pfade: Grundton je Tiefe, darüber je (Farbe, Höhenstufe, Tiefe) – wenige Striche statt tausender
      const keys = colors.voices.length + 1;
      const base = Array.from({ length: DEPTHS }, () => new Path2D());
      const lit = Array.from({ length: keys * (LEVELS - 1) * DEPTHS }, () => new Path2D());
      const edge = (p: number, q: number) => {
        if (!visible[p] || !visible[q]) return;
        const d = Math.min(depth[p]!, depth[q]!);
        if (d === 0) return;
        const top = level[p]! >= level[q]! ? p : q;
        const l = level[top]!;
        const path = l === 0 ? base[d]! : lit[(colorKey[top]! * (LEVELS - 1) + l - 1) * DEPTHS + d]!;
        path.moveTo(sx[p]!, sy[p]!);
        path.lineTo(sx[q]!, sy[q]!);
      };
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const k = j * N + i;
          if (i < N - 1) edge(k, k + 1);
          if (j < N - 1) edge(k, k + N);
          if (i < N - 1 && j < N - 1) edge(k, k + N + 1);
        }
      }

      // additiv: Kreuzungen und dichte Stellen leuchten auf
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 1;
      const fadeOf = (d: number) => d / (DEPTHS - 1);
      // Grundton: Spurfarbe, wenn nur eine Farbe spielt, sonst neutrales Violett
      const baseColor = colors.ground;
      ctx.strokeStyle = rgba(baseColor);
      for (let d = 1; d < DEPTHS; d++) {
        ctx.globalAlpha = alpha * fadeOf(d) * 0.3;
        ctx.stroke(base[d]!);
      }
      for (let key = 0; key < keys; key++) {
        const crest: Rgb = lighten(key < colors.voices.length ? colors.voices[key]!.rgb : colors.mix, 0.15);
        for (let l = 1; l < LEVELS; l++) {
          const t = l / (LEVELS - 1);
          ctx.strokeStyle = rgba(mixRgb(baseColor, crest, t));
          for (let d = 1; d < DEPTHS; d++) {
            ctx.globalAlpha = Math.min(1, alpha * fadeOf(d) * (0.32 + t * 0.45 + a.pulse * 0.12));
            ctx.stroke(lit[(key * (LEVELS - 1) + l - 1) * DEPTHS + d]!);
          }
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    },
  };
}
