/**
 * Zusatzpakete von Strudel, die @strudel/web nicht mitbringt (xen, midi, motion, csound).
 *
 * Sie werden erst geladen, wenn der Code sie braucht – also einen ihrer Namen
 * verwendet (außerhalb von Strings und Kommentaren). Dann landen ihre Exporte per
 * `evalScope` im Strudel-Scope; ihre Pattern-Methoden (`.tune()`, `.midi()`,
 * `.csound()` …) registrieren sich beim Import selbst am gemeinsamen `Pattern`.
 *
 * Wichtig: Alle Pakete müssen dieselbe @strudel/core-Instanz benutzen wie die
 * Engine – deshalb lädt der AudioAgent @strudel/web aus den Quellen (`web.mjs`)
 * statt aus dem Komplett-Bundle (siehe AudioAgent.createEngine).
 *
 * Reine Daten + Funktionen ohne Browser-Zugriff: in Node testbar, SSR-sicher
 * (die `import()`s laufen erst beim Aufruf von `load`).
 */

export type ExtensionId = 'xen' | 'midi' | 'motion' | 'csound';

export interface StrudelExtension {
  id: ExtensionId;
  /** npm-Paket (für Meldungen/Doku). */
  pkg: string;
  /** Namen, deren Verwendung im Code das Paket nachlädt (Exporte + registrierte Pattern-Methoden). */
  triggers: readonly string[];
  load: () => Promise<Record<string, unknown>>;
}

/** Sensor-Signale von @strudel/motion (alle Exporte außer enableMotion). */
const MOTION_SIGNALS = [
  'accelerationX', 'accelerationY', 'accelerationZ', 'accX', 'accY', 'accZ',
  'gravityX', 'gravityY', 'gravityZ', 'gravX', 'gravY', 'gravZ',
  'orientationAlpha', 'orientationBeta', 'orientationGamma',
  'orientationA', 'orientationB', 'orientationG', 'orientationX', 'orientationY', 'orientationZ',
  'oriA', 'oriB', 'oriG', 'oriX', 'oriY', 'oriZ',
  'absoluteOrientationAlpha', 'absoluteOrientationBeta', 'absoluteOrientationGamma',
  'absoluteOrientationX', 'absoluteOrientationY', 'absoluteOrientationZ',
  'absOriA', 'absOriB', 'absOriG', 'absOriX', 'absOriY', 'absOriZ',
  'rotationAlpha', 'rotationBeta', 'rotationGamma', 'rotationX', 'rotationY', 'rotationZ',
  'rotA', 'rotB', 'rotG', 'rotX', 'rotY', 'rotZ',
] as const;

export const STRUDEL_EXTENSIONS: readonly StrudelExtension[] = [
  {
    // Mikrotonale Stimmungen: .tune("…"), .xen("…"), .tuning([…]), edo(…). ~1,2 MB (Skalen-Datenbank) → nur bei Bedarf.
    id: 'xen',
    pkg: '@strudel/xen',
    triggers: ['xen', 'tune', 'tuning', 'edo'],
    load: () => import('@strudel/xen'),
  },
  {
    // MIDI-Ausgabe/-Eingabe über WebMIDI. Der Browser fragt erst bei .midi()/midin() nach der Erlaubnis.
    id: 'midi',
    pkg: '@strudel/midi',
    triggers: [
      'midi', 'midin', 'midikeys', 'midimaps', 'defaultmidimap', 'enableWebMidi',
      'WebMidi', 'midicontrolMap', 'midisoundMap',
    ],
    load: () => import('@strudel/midi'),
  },
  {
    // Gerätesensoren (Beschleunigung, Lage, Drehung) als Signale.
    // Quelle statt dist: das dist-Bundle enthält eine eigene Kopie von @strudel/core
    // (deren Patterns kennen weder Tonal- noch Webaudio-Methoden). Der relative Import
    // `../core/signal.mjs` wird in astro.config.mjs auf @strudel/core umgelenkt.
    id: 'motion',
    pkg: '@strudel/motion',
    triggers: [...MOTION_SIGNALS, 'enableMotion'],
    load: () => import('@strudel/motion/motion.mjs'),
  },
  {
    // Csound. Das Paket selbst ist klein; die große Wasm-Engine (@csound/browser) lädt es
    // erst beim ersten Ton von .csound()/.csoundm() bzw. bei loadCSound()/loadOrc().
    id: 'csound',
    pkg: '@strudel/csound',
    triggers: ['csound', 'csoundm', 'loadCSound', 'loadCsound', 'loadcsound', 'loadOrc'],
    load: () => import('@strudel/csound'),
  },
];

/**
 * Alle Bezeichner im Code außerhalb von Strings, Template-Text und Kommentaren.
 * Bewusst kein vollständiger JS-Tokenizer: Ein Fehlgriff lädt höchstens ein Paket
 * unnötig bzw. führt zur normalen „unbekannte Funktion“-Meldung.
 */
export function codeIdentifiers(code: string): Set<string> {
  const ids = new Set<string>();
  const n = code.length;
  let i = 0;
  // Verschachtelte Template-Ausdrücke `${…}`: Tiefe der geschweiften Klammern je Ebene.
  const templateDepth: number[] = [];
  const skipString = (quote: string): void => {
    i++;
    while (i < n && code[i] !== quote) {
      if (code[i] === '\\') i++;
      else if (code[i] === '\n') return; // unterbrochener String: Syntaxfehler, nicht weiter verschlucken
      i++;
    }
    i++;
  };
  // Liest Template-Text bis zum Ende oder bis `${` (dann Code-Modus).
  const skipTemplate = (): void => {
    while (i < n) {
      const ch = code[i];
      if (ch === '\\') i += 2;
      else if (ch === '`') {
        i++;
        return;
      } else if (ch === '$' && code[i + 1] === '{') {
        i += 2;
        templateDepth.push(0);
        return;
      } else i++;
    }
  };
  while (i < n) {
    const ch = code[i] ?? '';
    const next = code[i + 1];
    if (ch === '/' && next === '/') {
      while (i < n && code[i] !== '\n') i++;
    } else if (ch === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else if (ch === '"' || ch === "'") {
      skipString(ch);
    } else if (ch === '`') {
      i++;
      skipTemplate();
    } else if (ch === '{' && templateDepth.length) {
      templateDepth[templateDepth.length - 1]!++;
      i++;
    } else if (ch === '}' && templateDepth.length) {
      if (templateDepth[templateDepth.length - 1] === 0) {
        templateDepth.pop();
        i++;
        skipTemplate();
      } else {
        templateDepth[templateDepth.length - 1]!--;
        i++;
      }
    } else if (/[A-Za-z_$]/.test(ch)) {
      const start = i;
      while (i < n && /[\w$]/.test(code[i] ?? '')) i++;
      ids.add(code.slice(start, i));
    } else if (/\d/.test(ch)) {
      while (i < n && /[\w.]/.test(code[i] ?? '')) i++;
    } else i++;
  }
  return ids;
}

/** Welche Zusatzpakete braucht der Code? (In der Reihenfolge von STRUDEL_EXTENSIONS.) */
export function neededExtensions(code: string): StrudelExtension[] {
  const ids = codeIdentifiers(code);
  return STRUDEL_EXTENSIONS.filter((ext) => ext.triggers.some((name) => ids.has(name)));
}
