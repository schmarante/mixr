import { useStore } from '@nanostores/react';
import { useRef, useState } from 'react';
import { TEMPLATES } from '../../data/templates';
import { withBase } from '../../lib/paths';
import { uiState } from '../../store/agentBus';
import { historyState, redo, undo } from '../../store/actions';
import { useT } from '../../i18n/react';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useImportTriggers } from './hooks/useImportTriggers';
import { DropOverlay } from './import/DropOverlay';
import { MidiDialogs } from './midi/MidiDialogs';
import { midiExportOpen, pickMidiFile } from './lib/midiFlow';
import { nextVisualizerMode, setVisualizerEnabled, visualizerEnabled, visualizerMode } from './lib/visualizerPref';
import { ImportDialog } from './import/ImportDialog';
import { openImport } from './lib/importFlow';
import { keepPreludeSelection } from './lib/prelude';
import { ensureClientBoot } from './lib/boot';
import { cx } from './lib/cx';
import { modKey } from './lib/platform';
import { LogoWordmark } from './Logo';
import { IconButton, PeerTooltip } from './primitives/IconButton';
import { BarsIcon, CodeIcon, DownloadIcon, FolderIcon, ImportIcon, InfoIcon, MidiIcon, RedoIcon, SparklesIcon, UndoIcon, WaveIcon } from './primitives/Icons';
import { OverflowMenu } from './primitives/Menu';
import { downloadProject, filesFromInput, handleIncomingFiles, OPEN_FILE_ACCEPT, samplesDialogOpen } from './lib/projectFiles';
import { ProjectFileDialog } from './samples/ProjectFileDialog';
import { SamplesDialog } from './samples/SamplesDialog';
import { Toast } from './shared/Toast';
import { AboutDialog } from './topbar/AboutDialog';
import { BpmControl } from './topbar/BpmControl';
import { TemplatesDialog } from './topbar/TemplatesDialog';
import { BeatDots, EngineStatus, PlayButton } from './topbar/Transport';

ensureClientBoot();

/**
 * Topbar-Insel: Logo, Transport (Play/Stop, Tempo), Undo/Redo, Vorlagen, Import, Code-Ansicht, Über.
 * Registriert außerdem die globalen Tastenkürzel und die Import-Einstiege (Einfügen, Datei-Drop)
 * und rendert den Import-Dialog samt Bestätigung für alle Inseln.
 */
export default function TopBar() {
  useGlobalShortcuts();
  useImportTriggers();
  const { t } = useT();
  const history = useStore(historyState);
  const codeOpen = useStore(uiState).codePanelOpen;
  const visualizerOn = useStore(visualizerEnabled);
  const vizMode = useStore(visualizerMode);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const mod = modKey();
  const openFileRef = useRef<HTMLInputElement>(null);
  const hasTemplates = TEMPLATES.length > 0;

  return (
    <header className="glass relative z-20 grid h-16 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-line bg-panel px-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <a href={withBase('')} className="rounded-lg" aria-label={t('ui.topbar.home')}>
          <LogoWordmark />
        </a>
      </div>

      <div className="flex items-center gap-2.5 sm:gap-3.5" role="group" aria-label={t('ui.regions.playback')}>
        <PlayButton />
        <BpmControl />
        <BeatDots />
        {/* Status schwebt neben der Gruppe (kein Platz im Layout): sonst verschiebt
            „Lade Sounds…“ beim ersten Play die zentrierte Gruppe samt Play-Button. */}
        <span className="relative -ml-2.5 size-0 sm:-ml-3.5">
          <span className="absolute top-1/2 left-3 -translate-y-1/2 whitespace-nowrap">
            <EngineStatus />
          </span>
        </span>
      </div>

      <div className="flex items-center justify-end gap-1 sm:gap-1.5">
        <div className="hidden items-center sm:flex">
          <IconButton label={t('ui.topbar.undo')} kbd={`${mod}+Z`} onClick={() => keepPreludeSelection(undo)} disabled={!history.canUndo}>
            <UndoIcon />
          </IconButton>
          <IconButton label={t('ui.topbar.redo')} kbd={`⇧+${mod}+Z`} onClick={() => keepPreludeSelection(redo)} disabled={!history.canRedo}>
            <RedoIcon />
          </IconButton>
        </div>
        <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
        <span className="relative inline-flex">
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            aria-haspopup="dialog"
            aria-label={hasTemplates ? t('ui.topbar.templatesOpen') : t('ui.topbar.newProject')}
            className="peer inline-flex h-9 items-center gap-2 rounded-xl px-2.5 text-sm font-medium text-muted transition-colors hover:bg-hover hover:text-fg"
          >
            <SparklesIcon size={17} />
            <span className="hidden lg:inline">{hasTemplates ? t('ui.topbar.templates') : t('ui.topbar.new')}</span>
          </button>
          <PeerTooltip text={hasTemplates ? t('ui.topbar.templatesTooltip') : t('ui.topbar.newProjectTooltip')} />
        </span>
        {/* Auf dem Handy ausgeblendet (Platz) – Import dort über Startbildschirm und Code-Panel */}
        <span className="relative hidden sm:inline-flex">
          <button
            type="button"
            onClick={() => openImport()}
            aria-haspopup="dialog"
            aria-label={t('ui.import.open')}
            className="peer inline-flex h-9 items-center gap-2 rounded-xl px-2.5 text-sm font-medium text-muted transition-colors hover:bg-hover hover:text-fg"
          >
            <ImportIcon size={17} />
            <span className="hidden lg:inline">{t('ui.import.button')}</span>
          </button>
          <PeerTooltip text={t('ui.import.tooltip')} />
        </span>
        <span className="relative inline-flex">
          <button
            type="button"
            onClick={() => uiState.setKey('codePanelOpen', !codeOpen)}
            aria-pressed={codeOpen}
            aria-controls="code-monitor"
            aria-label={t('ui.topbar.codeShow')}
            className={cx(
              'peer inline-flex h-9 items-center gap-2 rounded-xl px-2.5 text-sm font-medium transition-colors',
              codeOpen ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-fg',
            )}
          >
            <CodeIcon size={17} />
            <span className="hidden lg:inline">{t('ui.topbar.code')}</span>
          </button>
          <PeerTooltip text={codeOpen ? t('ui.topbar.codeHideTooltip') : t('ui.topbar.codeShowTooltip')} side="left" />
        </span>
        <IconButton label={t('ui.samples.open')} onClick={() => samplesDialogOpen.set(true)} tooltip="left" hasPopup="dialog" className="hidden sm:inline-flex">
          <WaveIcon />
        </IconButton>
        <OverflowMenu
          label={t('ui.projectFile.menu')}
          items={[
            { id: 'samples', label: t('ui.samples.open'), icon: <WaveIcon size={15} />, onSelect: () => samplesDialogOpen.set(true) },
            { id: 'open', label: t('ui.projectFile.openFile'), icon: <FolderIcon size={15} />, onSelect: () => openFileRef.current?.click() },
            { id: 'download', label: t('ui.projectFile.download'), icon: <DownloadIcon size={15} />, onSelect: () => void downloadProject() },
            { id: 'midiImport', label: t('midi.ui.importMenu'), icon: <MidiIcon size={15} />, onSelect: pickMidiFile },
            { id: 'midiExport', label: t('midi.ui.exportMenu'), icon: <MidiIcon size={15} />, onSelect: () => midiExportOpen.set(true) },
            ...(visualizerOn
              ? [
                  {
                    id: 'visualizerNext',
                    label: t('ui.visualizer.next'),
                    icon: <SparklesIcon size={15} />,
                    hint: `${t(`ui.visualizer.modes.${vizMode}`)} · V`,
                    onSelect: () => void nextVisualizerMode(),
                  },
                ]
              : []),
            {
              id: 'visualizer',
              label: visualizerOn ? t('ui.topbar.visualizerHide') : t('ui.topbar.visualizerShow'),
              icon: <BarsIcon size={15} />,
              onSelect: () => setVisualizerEnabled(!visualizerOn),
            },
            { id: 'about', label: t('ui.topbar.about'), icon: <InfoIcon size={15} />, onSelect: () => setAboutOpen(true) },
          ]}
        />
        <input
          ref={openFileRef}
          type="file"
          multiple
          accept={OPEN_FILE_ACCEPT}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const files = filesFromInput(e.target.files);
            e.target.value = '';
            void handleIncomingFiles(files);
          }}
        />
      </div>

      <TemplatesDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={hasTemplates ? t('ui.topbar.templatesTitle') : t('ui.topbar.newProject')}
      />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <ImportDialog />
      <SamplesDialog />
      <ProjectFileDialog />
      <MidiDialogs />
      <DropOverlay />
      <Toast />
    </header>
  );
}
