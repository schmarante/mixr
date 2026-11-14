import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest-Konfiguration (bewusst ohne Astro-Vite-Config: die Tests sind reine
 * Logik-Tests in Node).
 *
 * @kabelsalat/web (Abhängigkeit von @strudel/core) deklariert in "main" ein
 * Browser-IIFE-Bundle; Node würde es statt des ESM-Builds laden und am fehlenden
 * Export `SalatRepl` scheitern. Deshalb zeigen wir explizit auf den ESM-Build und
 * lassen die Strudel-Pakete durch Vite transformieren.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@kabelsalat/web': fileURLToPath(new URL('./node_modules/@kabelsalat/web/dist/index.mjs', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    server: {
      deps: {
        inline: [/@strudel\//, /@kabelsalat\//],
      },
    },
  },
});
