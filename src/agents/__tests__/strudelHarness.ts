/**
 * Test-Harness: wertet erzeugten Code mit der echten, installierten Strudel-Version
 * in Node aus (core + mini + tonal, Transpiler wie in der REPL, `$:`-Blöcke,
 * setcpm). Kein Audio – es wird nur das resultierende Pattern abgefragt.
 */
import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import { transpiler } from '@strudel/transpiler';

export interface StrudelHap {
  begin: number;
  end: number;
  value: Record<string, unknown>;
}

interface Repl {
  evaluate(code: string, autostart?: boolean): Promise<unknown>;
  scheduler: { cps: number };
  state: { evalError?: unknown };
}

let replPromise: Promise<Repl> | undefined;

async function getRepl(): Promise<Repl> {
  replPromise ??= (async () => {
    await core.evalScope(core, mini, tonal);
    mini.miniAllStrings();
    return core.repl({
      defaultOutput: async () => {},
      getTime: () => 0,
      transpiler,
      setInterval: () => 0,
      clearInterval: () => {},
    }) as Repl;
  })();
  return replPromise;
}

/** Transpiliert nur (Syntax-Check wie im Browser). */
export function transpile(code: string): string {
  return transpiler(code, { emitMiniLocations: false, emitWidgets: false }).output as string;
}

/** Wertet Code aus; wirft bei Evaluationsfehlern. */
export async function evaluateStrudel(code: string): Promise<{ query: (from: number, to: number) => StrudelHap[]; cps: number }> {
  const repl = await getRepl();
  const pattern = (await repl.evaluate(code, false)) as { queryArc(a: number, b: number): RawHap[] } | undefined;
  if (repl.state.evalError) throw repl.state.evalError;
  if (!pattern) throw new Error('Strudel lieferte kein Pattern');
  return {
    cps: repl.scheduler.cps,
    query: (from, to) =>
      pattern
        .queryArc(from, to)
        .filter((h) => h.hasOnset())
        .map((h) => ({ begin: h.whole!.begin.valueOf(), end: h.whole!.end.valueOf(), value: h.value }))
        .sort((a, b) => a.begin - b.begin || JSON.stringify(a.value).localeCompare(JSON.stringify(b.value))),
  };
}

interface RawHap {
  whole?: { begin: { valueOf(): number }; end: { valueOf(): number } };
  value: Record<string, unknown>;
  hasOnset(): boolean;
}

/** Wertet ein einzelnes Pattern-Ausdruck aus (ohne `$:`), z. B. 's("bd*4")'. */
export async function queryExpr(expr: string, from = 0, to = 1): Promise<StrudelHap[]> {
  const { query } = await evaluateStrudel(`$: ${expr}`);
  return query(from, to);
}

export { core };
