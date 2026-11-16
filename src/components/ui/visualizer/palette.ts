/** Farbpaletten für die Pixel-Effekte (Plasma) als 256 RGBA-Werte für Uint32-Pufferzugriff. */

type Rgb = readonly [number, number, number];

function fromHex(c: string): Rgb {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Zyklischer Verlauf als RGB-Gleitkommawerte (size × 3): die Farben werden der Reihe
 * nach weich überblendet, die letzte zurück zur ersten. Gut zum Überblenden zweier Paletten.
 */
export function cyclicRamp(stops: readonly Rgb[], size = 256): Float32Array {
  const out = new Float32Array(size * 3);
  for (let i = 0; i < size; i++) {
    const pos = (i / size) * stops.length;
    const k = Math.floor(pos);
    const t = pos - k;
    // weiche Kurve statt linear – weniger sichtbare Kanten im Verlauf
    const s = t * t * (3 - 2 * t);
    const a = stops[k % stops.length]!;
    const b = stops[(k + 1) % stops.length]!;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = a[c]! + (b[c]! - a[c]!) * s;
  }
  return out;
}

/** RGB-Verlauf in gepackte Pixel umwandeln. Little-Endian (alle relevanten Browser): 0xAABBGGRR. */
export function packRamp(ramp: Float32Array, out: Uint32Array = new Uint32Array(ramp.length / 3)): Uint32Array {
  for (let i = 0; i < out.length; i++) {
    const r = Math.round(ramp[i * 3]!);
    const g = Math.round(ramp[i * 3 + 1]!);
    const b = Math.round(ramp[i * 3 + 2]!);
    out[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  return out;
}

/** Zyklische Palette aus Hex-Farben als gepackte Pixel. */
export function cyclicPalette(colors: readonly string[], size = 256): Uint32Array {
  return packRamp(cyclicRamp(colors.map(fromHex), size));
}
