/**
 * Strudel ohne Audio auswerten – für den MIDI-Export.
 *
 * Lädt @strudel/core, /mini, /tonal und /transpiler erst beim ersten Aufruf
 * (dynamischer Import). Im Browser sind das dieselben Modul-Instanzen wie die der
 * Engine (`@strudel/web/web.mjs` importiert genau diese Pakete) – eigene
 * Funktionen aus dem Setup-Code (`register(…)`) und Zusatzpakete teilen sich also
 * ein `Pattern`. Es entsteht bewusst kein zweites REPL: das würde globale
 * Scheduler-Funktionen (`setTime`, `setcpm`, `Pattern.prototype.p` …) der
 * laufenden Engine überschreiben. Stattdessen wird der kompilierte Code einer
 * einzelnen Spur zu einem Ausdruck umgeschrieben (`$:` entfernt, `setcpm` weg)
 * und direkt ausgewertet.
 */
import { neededExtensions } from '../strudelExtensions';

/** Was der Export von einem Hap braucht (Strudel liefert Fraction-Objekte). */
export interface HapLike {
  whole?: { begin: { valueOf(): number }; end: { valueOf(): number } } | null;
  value: unknown;
  hasOnset(): boolean;
}

export interface PatternLike {
  queryArc(begin: number, end: number): HapLike[];
}

/** Wertet Strudel-Code (eine Spur, wie vom Compiler erzeugt) zu einem Pattern aus. */
export type PatternEvaluator = (code: string) => Promise<PatternLike>;

/**
 * Compiler-Code einer Spur → auswertbares Programm, dessen letzter Ausdruck das
 * Pattern ist: `setcpm(…)` entfällt (das Tempo kennt der Export), das `$:`-Label
 * wird entfernt (der Transpiler gibt den letzten Ausdruck zurück).
 */
export function toExpressionProgram(code: string): string {
  return code
    .replace(/\r\n?/g, '\n')
    .replace(/^setcpm\([^)\n]*\)[ \t]*$/m, '')
    .replace(/^\$:[ \t]*/gm, '');
}

/** Scope-Namen der REPL, die es ohne Engine nicht gibt – als harmlose No-ops. */
const REPL_ONLY = ['setcpm', 'setcps', 'setCpm', 'setCps', 'hush', 'samples', 'aliasBank', 'soundAlias'];

let ready: Promise<PatternEvaluator> | null = null;

/** Lädt Strudel (einmalig) und liefert die Auswertungsfunktion. */
export function loadStrudelEvaluator(): Promise<PatternEvaluator> {
  ready ??= (async () => {
    const [core, mini, tonal, transpilerModule, audio] = await Promise.all([
      import('@strudel/core'),
      import('@strudel/mini'),
      import('@strudel/tonal'),
      import('@strudel/transpiler'),
      import('../AudioAgent'),
    ]);
    await core.evalScope(core, mini, tonal);
    mini.miniAllStrings();
    audio.installReplShims(core);
    const scope = globalThis as Record<string, unknown>;
    const extra: Record<string, unknown> = {};
    for (const name of REPL_ONLY) if (typeof scope[name] !== 'function') extra[name] = () => core.silence;
    if (Object.keys(extra).length > 0) await core.evalScope(extra);
    const loadedExtensions = new Set<string>();
    const transpile = (code: string, options: Record<string, unknown>) =>
      transpilerModule.transpiler(code, { ...options, emitMiniLocations: false, emitWidgets: false });

    return async (code: string): Promise<PatternLike> => {
      // Zusatzpakete (z. B. xen für .tune()) wie die Engine bei Bedarf in den Scope holen
      for (const ext of neededExtensions(code)) {
        if (loadedExtensions.has(ext.id) || ext.id === 'motion' || ext.id === 'csound') continue;
        await core.evalScope(await ext.load());
        loadedExtensions.add(ext.id);
      }
      const { pattern } = (await core.evaluate(toExpressionProgram(code), transpile)) as { pattern: unknown };
      if (!pattern || typeof (pattern as PatternLike).queryArc !== 'function') throw new Error('no pattern');
      return pattern as PatternLike;
    };
  })();
  ready.catch(() => {
    ready = null;
  });
  return ready;
}
