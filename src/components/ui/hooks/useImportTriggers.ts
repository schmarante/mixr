import { useEffect } from 'react';
import { looksLikeStrudelCode } from '../../../agents/importer';
import { t } from '../../../i18n';
import {
  IMPORT_MAX_BYTES,
  fileDragActive,
  importDialog,
  isImportFileName,
  isStrudelLink,
  openImport,
  showToast,
} from '../lib/importFlow';
import { collectDropped, dragKindOf, dropSlotId, fileDragKind, handleIncomingFiles } from '../lib/projectFiles';
import { isTypingTarget } from './useGlobalShortcuts';

function hasFiles(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes('Files') === true;
}

/** Liest eine abgelegte/gewählte Datei und öffnet damit den Import-Dialog. */
export async function importFromFile(file: File): Promise<void> {
  if (!isImportFileName(file.name)) {
    showToast(t('ui.import.fileWrongType', { name: file.name }));
    return;
  }
  if (file.size > IMPORT_MAX_BYTES) {
    showToast(t('ui.import.fileTooLarge', { name: file.name }));
    return;
  }
  try {
    openImport(await file.text(), file.name);
  } catch {
    showToast(t('ui.import.fileUnreadable', { name: file.name }));
  }
}

/**
 * Einstiege ohne Klick:
 * - Einfügen (Strg/⌘+V) außerhalb von Eingabefeldern: sieht der Text nach Strudel-Code
 *   aus oder ist er ein strudel.cc-Link → Import-Dialog vorbefüllt öffnen.
 * - Dateien/Ordner aufs Fenster ziehen: Code → Import-Dialog, Audio/Ordner → Sample-Slots
 *   (über einer Slot-Kachel: in diesen Slot), Projekt-ZIP/mixr.json → Projekt öffnen.
 */
export function useImportTriggers(): void {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      // Andere modale Dialoge nicht überfahren (der Import-Dialog hat sein eigenes Textfeld)
      if (document.querySelector('dialog[open]')) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text.trim() === '') return;
      if (isStrudelLink(text) || looksLikeStrudelCode(text)) {
        e.preventDefault();
        openImport(text);
      }
    };

    /*
     * Ziehen erkennen: dragenter/dragleave zählen (jedes Kind-Element feuert beides, das
     * neue dragenter kommt vor dem alten dragleave) – bei 0 hat die Datei das Fenster
     * verlassen bzw. das Ziehen wurde abgebrochen. Nicht über ein Timeout nach dem letzten
     * dragover: Chromium unter Linux schickt dragover nur bei Mausbewegung, die Fläche
     * verschwände also beim Stillhalten.
     */
    let depth = 0;
    const endDrag = () => {
      depth = 0;
      if (fileDragActive.get()) fileDragActive.set(false);
      if (fileDragKind.get() !== null) fileDragKind.set(null);
      if (dropSlotId.get() !== null) dropSlotId.set(null);
    };
    const slotUnder = (target: EventTarget | null): string | null =>
      target instanceof Element ? (target.closest<HTMLElement>('[data-slot-id]')?.dataset['slotId'] ?? null) : null;
    const track = (e: DragEvent) => {
      if (!fileDragActive.get()) fileDragActive.set(true);
      const kind = dragKindOf(e.dataTransfer);
      if (fileDragKind.get() !== kind) fileDragKind.set(kind);
      const slot = slotUnder(e.target);
      if (dropSlotId.get() !== slot) dropSlotId.set(slot);
    };
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      track(e);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      track(e);
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      // Fenster verlassen (relatedTarget null + Zeiger außerhalb) oder alle Ebenen verlassen
      const outside = e.relatedTarget === null && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= innerWidth || e.clientY >= innerHeight);
      if (depth === 0 || outside) endDrag();
    };
    // Sicherheitsnetz: Während eines Datei-Drags gibt es keine Mausereignisse – kommt eines,
    // ist das Ziehen vorbei (z. B. Abbruch, bei dem kein dragleave ankam).
    const onPointer = () => {
      if (fileDragActive.get()) endDrag();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return;
      e.preventDefault();
      const slot = slotUnder(e.target);
      endDrag();
      const dt = e.dataTransfer;
      // Einträge synchron im Drop-Handler holen (danach ist das DataTransfer leer)
      void collectDropped(dt).then((files) => {
        if (files.length === 0 && !importDialog.get().open) openImport();
        else void handleIncomingFiles(files, slot === 'new' ? null : slot);
      });
    };

    window.addEventListener('paste', onPaste);
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('pointermove', onPointer);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, []);
}
