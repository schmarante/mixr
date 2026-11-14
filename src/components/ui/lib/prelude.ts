import { projectSettings, uiState } from '../../../store/agentBus';

/**
 * Setup-Code („prelude“) des Projekts – Hilfen für Karte, Inspector und Import-Vorschau.
 * Die Auswahl nutzt die reservierte ID PRELUDE_ID in uiState.selectedNodeId; sie
 * kollidiert nicht mit Knoten-IDs (die tragen immer ein Präfix wie „track-“/„block-“).
 */
export const PRELUDE_ID = 'prelude';

/** Namen, die der Setup-Code definiert: register('name', …), function/const/let/var name. */
export function preludeNames(code: string): string[] {
  const names = new Set<string>();
  for (const m of code.matchAll(/\bregister\(\s*(['"`])([\w$]+)\1/g)) names.add(m[2]!);
  for (const m of code.matchAll(/^\s*(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]!);
  return [...names];
}

/** Die ersten `count` aussagekräftigen Zeilen (ohne Leerzeilen) für eine kurze Vorschau. */
export function preludePreview(code: string, count = 2): string[] {
  return code
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '')
    .slice(0, count);
}

/**
 * Undo/Redo stellen nur echte Knoten-Auswahlen wieder her (restore() hebt alles andere
 * auf). Damit der Setup-Code-Editor offen bleibt, wenn es den Setup-Code danach noch
 * gibt, laufen die UI-Aufrufe von Undo/Redo hierüber.
 */
export function keepPreludeSelection(action: () => void): void {
  const wasSelected = uiState.get().selectedNodeId === PRELUDE_ID;
  action();
  if (wasSelected && projectSettings.get().prelude?.trim()) uiState.setKey('selectedNodeId', PRELUDE_ID);
}
