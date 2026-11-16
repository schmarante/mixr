// Renders scripts/og-image.svg to public/og-image.png (link preview, 1200×630).
// Uses only the fonts shipped in src/fonts: the WOFF2 files are decompressed to TTF in a temp
// directory, and fontconfig is pointed at that directory alone – no system fonts, so a missing
// glyph shows up as a box instead of silently falling back to another typeface.
// Run with `npm run og-image` (Node ≥ 22, e.g. inside ddev).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import wawoff2 from 'wawoff2';

const root = fileURLToPath(new URL('..', import.meta.url));
const fontsDir = path.join(root, 'src/fonts');
const svgPath = path.join(root, 'scripts/og-image.svg');
const outPath = path.join(root, 'public/og-image.png');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mixr-og-'));
try {
  const fonts = fs.readdirSync(fontsDir).filter((f) => f.endsWith('.woff2'));
  if (fonts.length === 0) throw new Error(`no .woff2 fonts in ${fontsDir}`);
  for (const file of fonts) {
    const ttf = await wawoff2.decompress(fs.readFileSync(path.join(fontsDir, file)));
    fs.writeFileSync(path.join(tmp, file.replace(/\.woff2$/, '.ttf')), ttf);
  }

  const conf = path.join(tmp, 'fonts.conf');
  fs.writeFileSync(
    conf,
    `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${tmp}</dir>\n  <cachedir>${path.join(tmp, 'cache')}</cachedir>\n</fontconfig>\n`,
  );
  // Must be set before sharp (libvips/fontconfig) is loaded.
  process.env.FONTCONFIG_FILE = conf;
  const { default: sharp } = await import('sharp');

  const info = await sharp(svgPath).resize(1200, 630).png().toFile(outPath);
  console.log(`${path.relative(root, outPath)}: ${info.width}×${info.height}, ${info.size} bytes (fonts: ${fonts.join(', ')})`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
