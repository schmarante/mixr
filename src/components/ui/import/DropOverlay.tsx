import { useStore } from '@nanostores/react';
import { createPortal } from 'react-dom';
import type { TKey } from '../../../i18n';
import { useT } from '../../../i18n/react';
import { fileDragActive, importDialog } from '../lib/importFlow';
import { midiExportOpen, pendingMidi } from '../lib/midiFlow';
import { fileDragKind, pendingProject, samplesDialogOpen, type DragKind } from '../lib/projectFiles';
import { ImportIcon } from '../primitives/Icons';

/** Was beim Loslassen passiert – nach Art der gezogenen Dateien. */
const TEXTS: Record<DragKind, { title: TKey; text: TKey }> = {
  code: { title: 'ui.import.dropTitle', text: 'ui.import.dropText' },
  audio: { title: 'ui.samples.dropOverlayTitle', text: 'ui.samples.dropOverlayText' },
  project: { title: 'ui.projectFile.dropTitle', text: 'ui.projectFile.dropText' },
  midi: { title: 'midi.ui.dropTitle', text: 'midi.ui.dropText' },
  mixed: { title: 'ui.projectFile.dropAnyTitle', text: 'ui.projectFile.dropAnyText' },
};

/** Hinweis-Fläche, solange Dateien über das Fenster gezogen werden (nicht bei offenem Dialog). */
export function DropOverlay() {
  const { t } = useT();
  const active = useStore(fileDragActive);
  const kind = useStore(fileDragKind) ?? 'mixed';
  const importOpen = useStore(importDialog).open;
  const samplesOpen = useStore(samplesDialogOpen);
  const pending = useStore(pendingProject);
  const midiPending = useStore(pendingMidi);
  const midiExport = useStore(midiExportOpen);
  const dialogOpen = importOpen || samplesOpen || pending !== null || midiPending !== null || midiExport;
  if (!active || dialogOpen || typeof document === 'undefined') return null;
  const text = TEXTS[kind];

  return createPortal(
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[60] flex bg-canvas/70 p-3 backdrop-blur-[2px] motion-safe:animate-fade-in"
    >
      {/* Fast bildschirmgroß (12 px Rand): die ganze Fläche ist Ablageziel */}
      <div className="flex size-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-accent/70 bg-panel/80 px-6 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <ImportIcon size={26} />
        </span>
        <p className="text-lg font-semibold text-fg">{t(text.title)}</p>
        <p className="max-w-md text-sm text-muted">{t(text.text)}</p>
      </div>
    </div>,
    document.body,
  );
}
