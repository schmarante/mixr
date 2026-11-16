import { projectSettings, visualAstStore } from './agentBus';
import type { ProjectSettings, VisualAst } from '../types/ast';

/**
 * Speichert das Projekt im localStorage. NUR im Browser aufrufen
 * (z. B. aus einem useEffect oder Astro-<script>), nie beim SSR.
 */

const KEY = 'mixr:project:v1';

interface StoredProject {
  ast: VisualAst;
  settings: ProjectSettings;
}

function isStoredProject(v: unknown): v is StoredProject {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Partial<StoredProject>;
  return Array.isArray(p.ast?.nodes) && Array.isArray(p.ast?.edges) && typeof p.settings?.bpm === 'number';
}

let started = false;

/**
 * Lädt einen gespeicherten Stand (falls vorhanden) und speichert danach jede
 * Änderung (debounced). Idempotent.
 * @returns true, wenn ein gespeichertes Projekt geladen wurde
 */
export function initPersistence(): boolean {
  if (started || typeof window === 'undefined') return false;
  started = true;
  let restored = false;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (isStoredProject(parsed)) {
      visualAstStore.set(parsed.ast);
      projectSettings.set(parsed.settings);
      restored = parsed.ast.nodes.length > 0;
    }
  } catch {
    // Speicher nicht verfügbar oder kaputt → mit leerem Projekt starten
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const data: StoredProject = { ast: visualAstStore.get(), settings: projectSettings.get() };
        window.localStorage.setItem(KEY, JSON.stringify(data));
      } catch {
        // z. B. privater Modus – Speichern ist Komfort, kein Muss
      }
    }, 300);
  };
  visualAstStore.listen(save);
  projectSettings.listen(save);
  return restored;
}
