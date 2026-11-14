/**
 * Compiler-Agent: übersetzt den visuellen AST in Strudel-Code.
 *
 * - `compile()` ist eine reine Funktion (SSR-sicher, keine Browser-APIs) und
 *   lebt in ./compiler/ (Formatierung, Parameter-Validierung, Block-Mapping,
 *   Raster-Kompression).
 * - `startCompilerAgent()` verbindet sie mit dem Event-Bus.
 *
 * Warum kein Web Worker (wie in der Architektur-Skizze angedacht)? Die
 * Kompilierung ist ein linearer Durchlauf über wenige Dutzend Knoten und dauert
 * Mikrosekunden. Ein Worker brächte nur Serialisierungs-Overhead, asynchrone
 * Latenz und doppelte Store-Synchronisation – deshalb läuft der Agent im
 * Main-Thread und bündelt Änderungen per Microtask.
 */
import { languageStore } from '../i18n';
import { compileState, compiledStrudelCode, projectSettings, visualAstStore } from '../store/agentBus';
import type { CompileDiagnostic } from '../store/agentBus';
import { compile } from './compiler/compile';

export { compile } from './compiler/compile';
export type { CompileResult } from './compiler/compile';

let started = false;

/**
 * Abonniert visualAstStore/projectSettings und schreibt compiledStrudelCode/compileState.
 * Idempotent. Nur im Browser aktiv (auf dem Server sind die Stores geteilt und read-only).
 */
export function startCompilerAgent(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  let scheduled = false;
  const run = () => {
    scheduled = false;
    const result = compile(visualAstStore.get(), projectSettings.get());
    if (result.code !== compiledStrudelCode.get()) compiledStrudelCode.set(result.code);
    if (!sameDiagnostics(result.diagnostics, compileState.get().diagnostics)) {
      compileState.setKey('diagnostics', result.diagnostics);
    }
  };
  // Mehrere synchrone Änderungen (z. B. Vorlage laden = AST + Tempo) → eine Kompilierung.
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(run);
  };

  visualAstStore.listen(schedule);
  projectSettings.listen(schedule);
  // Diagnosen sind Text in der aktuellen Sprache → bei Sprachwechsel neu erzeugen.
  languageStore.listen(schedule);
  run();
}

function sameDiagnostics(a: CompileDiagnostic[], b: CompileDiagnostic[]): boolean {
  return a.length === b.length && a.every((d, i) => d.nodeId === b[i]!.nodeId && d.message === b[i]!.message);
}
