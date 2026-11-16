import { useStore } from '@nanostores/react';
import { compileState, projectSettings, resolvedTracks, uiState } from '../../store/agentBus';
import { selectNode } from '../../store/actions';
import { useT } from '../../i18n/react';
import { BlockInspector } from './inspector/BlockInspector';
import { EmptyInspector } from './inspector/EmptyInspector';
import { PreludeInspector } from './inspector/PreludeInspector';
import { TrackInspector } from './inspector/TrackInspector';
import { ensureClientBoot } from './lib/boot';
import { cx } from './lib/cx';
import { dismissGuide, guideDismissed } from './lib/guide';
import { PRELUDE_ID } from './lib/prelude';
import { IconButton } from './primitives/IconButton';
import { CloseIcon } from './primitives/Icons';

ensureClientBoot();

/**
 * Inspector-Insel (DAW-artiges Detail-Panel unter den Spuren):
 * zeigt die Einstellungen des ausgewählten Bausteins bzw. der ausgewählten Spur
 * oder den Setup-Code des Projekts.
 * Volle Breite, damit Step-Sequencer und Piano-Roll große Klickflächen haben.
 */
export default function ParameterSidebar() {
  const { t } = useT();
  const tracks = useStore(resolvedTracks);
  const selectedId = useStore(uiState).selectedNodeId;
  const diagnostics = useStore(compileState).diagnostics;
  const guideHidden = useStore(guideDismissed);
  const prelude = useStore(projectSettings).prelude;

  // Ohne Spuren zeigt der Workspace den Startbildschirm – hier nichts anzeigen
  if (tracks.length === 0) return null;

  let content = <EmptyInspector />;
  let hasSelection = false;
  if (selectedId === PRELUDE_ID) {
    // Setup-Code (reservierte Auswahl-ID); ohne Setup-Code → wie keine Auswahl
    if (prelude?.trim()) {
      content = <PreludeInspector code={prelude} />;
      hasSelection = true;
    }
  } else if (selectedId) {
    const trackHit = tracks.find((t) => t.track.id === selectedId);
    if (trackHit) {
      content = <TrackInspector key={trackHit.track.id} rt={trackHit} />;
      hasSelection = true;
    } else {
      for (const rt of tracks) {
        const block = rt.chain.find((b) => b.id === selectedId);
        if (block) {
          content = (
            <BlockInspector
              key={block.id}
              block={block}
              track={rt.track}
              diagnostics={diagnostics.filter((d) => d.nodeId === block.id).map((d) => d.message)}
            />
          );
          hasSelection = true;
          break;
        }
      }
    }
  }

  // Ohne Auswahl und ohne Kurzanleitung: Panel einklappen – mehr Platz für die Spuren
  if (!hasSelection && guideHidden) return null;

  return (
    <section
      aria-label={t('ui.regions.settings')}
      data-inspector
      className={cx(
        hasSelection ? 'block' : 'hidden sm:block',
        'relative max-h-[min(58dvh,42rem)] shrink-0 overflow-y-auto glass-scroll border-t border-line-strong bg-panel shadow-[0_-12px_32px_-12px_rgb(0_0_0/0.6)] motion-safe:animate-fade-in',
      )}
    >
      <div className="mx-auto max-w-[110rem] px-4 py-5 sm:px-6">
        <div className="absolute top-3 right-3 z-10">
          {hasSelection ? (
            <IconButton label={t('ui.inspector.deselect')} kbd={t('common.keys.esc')} tooltip="left" onClick={() => selectNode(null)}>
              <CloseIcon />
            </IconButton>
          ) : (
            <IconButton label={t('ui.emptyInspector.dismiss')} tooltip="left" onClick={dismissGuide}>
              <CloseIcon />
            </IconButton>
          )}
        </div>
        <div className="pr-10">{content}</div>
      </div>
    </section>
  );
}
