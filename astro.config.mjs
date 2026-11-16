// @ts-check
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';

import tailwindcss from '@tailwindcss/vite';

/** Version: major.minor aus package.json + Anzahl Git-Commits (ohne Git: package.json-Version). */
function appVersion() {
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  const git = (/** @type {string} */ args) =>
    execSync(`git ${args}`, { cwd: fileURLToPath(new URL('.', import.meta.url)), stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  try {
    const commits = git('rev-list --count HEAD');
    const dirty = git('status --porcelain') !== '';
    return `${version.split('.').slice(0, 2).join('.')}.${commits}${dirty ? '-dev' : ''}`;
  } catch {
    return version;
  }
}

const inDdev = process.env.IS_DDEV_PROJECT === 'true';

/**
 * Zwei Build-Ziele:
 * - Standard (ddev, eigener Server): SSR mit @astrojs/node – der Server rendert die Seite
 *   gleich in der Sprache aus Cookie bzw. Accept-Language.
 * - BUILD_TARGET=static (GitHub Pages): rein statisch, die Sprache wählt der Browser.
 *   BASE_PATH (z. B. „/mixr/“) und SITE_URL setzt der Workflow aus den Pages-Einstellungen.
 */
const isStatic = process.env.BUILD_TARGET === 'static';

// https://astro.build/config
export default defineConfig({
  output: isStatic ? 'static' : 'server',
  ...(isStatic ? {} : { adapter: node({ mode: 'standalone' }) }),
  base: process.env.BASE_PATH || '/',
  ...(process.env.SITE_URL ? { site: process.env.SITE_URL } : {}),
  integrations: [react()],
  server: {
    host: '0.0.0.0',
    port: 4321,
    allowedHosts: true,
  },
  vite: {
    define: { __APP_VERSION__: JSON.stringify(appVersion()) },
    server: inDdev
      ? {
          // HMR läuft über den ddev-Router (Traefik, HTTPS)
          hmr: { protocol: 'wss', clientPort: 443 },
        }
      : {},

    plugins: [tailwindcss()],
    resolve: {
      alias: [
        // @strudel/motion wird aus der Quelle geladen (src/agents/strudelExtensions.ts); sie
        // importiert `signal` relativ aus dem Monorepo („../core/signal.mjs“). Umgelenkt auf das
        // Paket @strudel/core, damit es bei einer einzigen core-Instanz bleibt.
        { find: /^\.\.\/core\/signal\.mjs$/, replacement: '@strudel/core' },
      ],
    },
    optimizeDeps: {
      // Dev: Der Dep-Optimizer wendet den Alias oben nicht auf relative Importe an – motion
      // deshalb nicht vorbündeln; @strudel/core als eigener Einstieg teilt sich dann den
      // core-Chunk mit @strudel/web/web.mjs.
      exclude: ['@strudel/motion'],
      include: ['@strudel/core'],
    },
  },
});
