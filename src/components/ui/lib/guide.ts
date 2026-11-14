import { atom } from 'nanostores';
import { uiState } from '../../../store/agentBus';

/**
 * Kurzanleitung im leeren Inspector („Baustein anklicken …“): nur für Neulinge.
 * Sie verschwindet dauerhaft, wenn sie geschlossen wird oder sobald – während sie
 * zu sehen war – ein Baustein bzw. eine Spur ausgewählt wird (Prinzip verstanden).
 * Automatische Auswahl (z. B. neue Spur) zählt nicht, solange sie noch nicht sichtbar war. Gemerkt im
 * localStorage – reine Komfortfunktion, ohne Speicher wird sie einfach wieder gezeigt.
 */
const KEY = 'smx-guide-dismissed';

function readDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export const guideDismissed = atom<boolean>(readDismissed());

export function dismissGuide() {
  if (guideDismissed.get()) return;
  guideDismissed.set(true);
  try {
    window.localStorage.setItem(KEY, '1');
  } catch {
    // privater Modus o. Ä. – dann nur für diese Sitzung
  }
}

let seen = false;

/** Vom Inspector aufgerufen, sobald die Anleitung tatsächlich angezeigt wird. */
export function markGuideSeen() {
  seen = true;
}

// Auswahl nach dem Sehen der Anleitung = Prinzip verstanden → künftig nicht mehr zeigen
if (typeof window !== 'undefined' && !guideDismissed.get()) {
  const unsubscribe = uiState.listen((s) => {
    if (seen && s.selectedNodeId) {
      dismissGuide();
      unsubscribe();
    }
  });
}
