import { atom } from 'nanostores';
import { t } from '../../../i18n';
import { playbackState, projectSettings, visualAstStore } from '../../../store/agentBus';
import { appendProject, loadProject } from '../../../store/actions';
import {
  exportProjectZip,
  openProjectArchive,
  parseProjectFile,
  PROJECT_FILE_NAME,
  ProjectFileError,
  projectDownloadName,
  projectSettingsOf,
  type ProjectFile,
} from '../../../store/projectFile';
import {
  getSampleBlob,
  importSampleFiles,
  isAudioFileName,
  missingSampleFiles,
  putSampleBlob,
  refreshSampleBlobs,
  sampleBlobs,
  type IncomingAudio,
} from '../../../store/userSamples';
import { isImportFileName, showToast } from './importFlow';
import { MIDI_MIME, isMidiFileName, openMidiFile } from './midiFlow';
import { requestPlay } from './transport';

/**
 * Dateien rein und raus: Projekt-ZIP/JSON, eigene Samples (Dateien, Ordner, ZIP),
 * Strudel-Code. Gemeinsamer Einstieg für Drag & Drop, Datei-Auswahl und Topbar-Menü.
 */

/* ------------------------------------------------------------------ */
/* Zustand                                                             */
/* ------------------------------------------------------------------ */

/** Samples-Panel offen? */
export const samplesDialogOpen = atom(false);

/** Projekt aus einer Datei, das auf „Öffnen/Hinzufügen“ wartet. */
export interface PendingProject {
  project: ProjectFile;
  /** Anzeigename (aus dem Dateinamen). */
  name: string;
  /** Zahl der Sample-Dateien ohne Audiodaten. */
  missing: number;
}
export const pendingProject = atom<PendingProject | null>(null);

/** Name des zuletzt geöffneten Projekts (für den Download-Dateinamen). */
export const projectName = atom('');

/** Was beim Loslassen passieren würde (für das Drop-Overlay). */
export type DragKind = 'code' | 'audio' | 'project' | 'midi' | 'mixed';
export const fileDragKind = atom<DragKind | null>(null);

/** Slot, über dem gerade eine Datei schwebt (Hervorhebung). */
export const dropSlotId = atom<string | null>(null);

/* ------------------------------------------------------------------ */
/* Dateien sammeln                                                     */
/* ------------------------------------------------------------------ */

export interface DroppedFile {
  /** Pfad inkl. Ordnern (bei Ordner-Drops), sonst nur der Name. */
  path: string;
  file: File;
}

/** Dateien und (rekursiv) Ordner aus einem Drop – wie strudel.cc „import sounds“. */
export async function collectDropped(dt: DataTransfer): Promise<DroppedFile[]> {
  // Einträge synchron holen – nach dem Drop-Ereignis ist das DataTransfer leer
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.() ?? null).filter((e): e is FileSystemEntry => e !== null);
  if (entries.length === 0) return [...dt.files].map((file) => ({ path: file.name, file }));
  const out: DroppedFile[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((ok, err) => (entry as FileSystemFileEntry).file(ok, err));
      out.push({ path: prefix + file.name, file });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((ok, err) => reader.readEntries(ok, err));
        if (batch.length === 0) break;
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

/** Dateien aus einem <input type="file"> (auch webkitdirectory → relative Pfade). */
export function filesFromInput(list: FileList | null): DroppedFile[] {
  return [...(list ?? [])].map((file) => ({ path: file.webkitRelativePath || file.name, file }));
}

/** Art eines laufenden Drags (nur MIME-Typen sind bekannt, keine Namen). */
export function dragKindOf(dt: DataTransfer | null): DragKind {
  const types = [...(dt?.items ?? [])].filter((i) => i.kind === 'file').map((i) => i.type);
  if (types.length === 0) return 'mixed';
  if (types.every((x) => MIDI_MIME.test(x))) return 'midi';
  if (types.every((x) => x.startsWith('audio/') && !MIDI_MIME.test(x))) return 'audio';
  if (types.every((x) => /zip|json/.test(x))) return 'project';
  if (types.every((x) => /javascript|text\/plain/.test(x))) return 'code';
  return 'mixed';
}

/* ------------------------------------------------------------------ */
/* Dateien verarbeiten                                                 */
/* ------------------------------------------------------------------ */

const lower = (s: string) => s.toLowerCase();
const isZipName = (n: string) => lower(n).endsWith('.zip');
const isJsonName = (n: string) => lower(n).endsWith('.json');

function stem(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

async function offerProject(project: ProjectFile, name: string): Promise<void> {
  await refreshSampleBlobs();
  const missing = missingSampleFiles(project.settings.samples ?? [], sampleBlobs.get()).length;
  pendingProject.set({ project, name, missing });
}

function samplesToast(res: { slots: string[]; relinked: number; skipped: number }): void {
  const parts: string[] = [];
  if (res.slots.length > 0) parts.push(t('ui.samples.toast.added', { count: res.slots.length, names: res.slots.slice(0, 3).join(', ') }));
  if (res.relinked > 0) parts.push(t('ui.samples.toast.relinked', { count: res.relinked }));
  if (res.skipped > 0) parts.push(t('ui.samples.toast.skipped', { count: res.skipped }));
  if (parts.length > 0) showToast(parts.join(' · '), { undo: res.slots.length > 0 });
}

/**
 * Verarbeitet hereinkommende Dateien:
 * - ZIP mit strudelmixr.json → Projekt (Dialog ersetzen/hinzufügen), sonst Sample-Ordner
 * - strudelmixr.json → Projekt (fehlende Samples markiert)
 * - Audio (auch in Ordnern) → Slots (bzw. in den Ziel-Slot, fehlende werden verknüpft)
 * - .mid/.midi → MIDI-Import (Vorschau, dann ersetzen/hinzufügen)
 * - .js/.txt/.strudel → Code-Import
 */
export async function handleIncomingFiles(files: DroppedFile[], targetSlotId?: string | null): Promise<void> {
  if (files.length === 0) return;
  try {
    const zip = files.find((f) => isZipName(f.path));
    if (zip) {
      const archive = await openProjectArchive(new Uint8Array(await zip.file.arrayBuffer()));
      if (archive.project) {
        for (const [id, data] of archive.blobs) {
          const meta = archive.project.settings.samples?.flatMap((s) => s.files).find((f) => f.id === id);
          await putSampleBlob(id, new Blob([data as BlobPart], { type: meta?.mime ?? '' }));
        }
        projectName.set(stem(zip.file.name).replace(/^strudelmixr-?/, ''));
        await offerProject(archive.project, stem(zip.file.name));
        return;
      }
      const audio: IncomingAudio[] = archive.looseAudio.map((e) => ({
        // ZIP-Name als Wurzelordner: lose Dateien im ZIP werden ein Klang nach dem ZIP-Namen
        path: e.path.includes('/') ? e.path : `${stem(zip.file.name)}/${e.path}`,
        blob: new Blob([e.data as BlobPart]),
      }));
      if (audio.length === 0) {
        showToast(t('ui.projectFile.errors.emptyZip'));
        return;
      }
      samplesToast(await importSampleFiles(audio, targetSlotId));
      samplesDialogOpen.set(true);
      return;
    }

    const json = files.find((f) => isJsonName(f.path));
    if (json) {
      const project = parseProjectFile(await json.file.text());
      if (json.file.name !== PROJECT_FILE_NAME) projectName.set(stem(json.file.name).replace(/^strudelmixr-?/, ''));
      await offerProject(project, stem(json.file.name));
      return;
    }

    const midi = files.find((f) => isMidiFileName(f.path));
    if (midi) {
      await openMidiFile(midi.file);
      return;
    }

    const audio = files.filter((f) => isAudioFileName(f.path));
    if (audio.length > 0) {
      const res = await importSampleFiles(
        audio.map((f) => ({ path: f.path, blob: f.file })),
        targetSlotId,
      );
      samplesToast({ ...res, skipped: res.skipped + files.length - audio.length });
      samplesDialogOpen.set(true);
      return;
    }

    const code = files.find((f) => isImportFileName(f.path));
    if (code) {
      const { importFromFile } = await import('../hooks/useImportTriggers');
      await importFromFile(code.file);
      return;
    }
    showToast(t('ui.projectFile.errors.unknownFile', { name: files[0]!.file.name }));
  } catch (err) {
    if (err instanceof ProjectFileError) showToast(t(err.messageKey));
    else {
      console.warn('[files] import failed', err);
      showToast(t('ui.projectFile.errors.unreadable'));
    }
  }
}

/* ------------------------------------------------------------------ */
/* Projekt öffnen (aus dem Dialog)                                     */
/* ------------------------------------------------------------------ */

/** Übernimmt das wartende Projekt – synchron im Klick (Autoplay = User-Geste). */
export function applyPendingProject(mode: 'replace' | 'append', autoplay: boolean): void {
  const pending = pendingProject.get();
  if (!pending) return;
  const { project } = pending;
  const settings = projectSettingsOf(project);
  if (mode === 'append') appendProject(project.ast, settings.prelude, settings.samples);
  else loadProject(project.ast, settings);
  pendingProject.set(null);
  if (autoplay && !playbackState.get().isPlaying) requestPlay();
  const tracks = project.ast.nodes.filter((n) => n.type === 'track').length;
  const parts = [t(mode === 'append' ? 'ui.import.toast.added' : 'ui.projectFile.toast.opened', { count: tracks })];
  const slots = settings.samples?.length ?? 0;
  if (slots > 0) parts.push(t('ui.projectFile.toast.samples', { count: slots }));
  if (pending.missing > 0) parts.push(t('ui.projectFile.toast.missing', { count: pending.missing }));
  showToast(parts.join(' · '), { undo: true });
}

/* ------------------------------------------------------------------ */
/* Herunterladen                                                       */
/* ------------------------------------------------------------------ */

function saveBytes(bytes: Uint8Array, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Lädt das Projekt als ZIP herunter (strudelmixr.json + samples/…). */
export async function downloadProject(): Promise<void> {
  try {
    const { zip, missing } = await exportProjectZip(visualAstStore.get(), projectSettings.get(), getSampleBlob);
    saveBytes(zip, projectDownloadName(projectName.get(), 'zip'), 'application/zip');
    const slots = projectSettings.get().samples?.length ?? 0;
    showToast(
      [t('ui.projectFile.toast.downloaded'), slots > 0 ? t('ui.projectFile.toast.samples', { count: slots }) : null, missing > 0 ? t('ui.projectFile.toast.missing', { count: missing }) : null]
        .filter(Boolean)
        .join(' · '),
    );
  } catch (err) {
    console.warn('[files] export failed', err);
    showToast(t('ui.projectFile.errors.exportFailed'));
  }
}

/** Datei-Auswahl für alles, was man auch hereinziehen kann. */
export const OPEN_FILE_ACCEPT = '.zip,.json,.js,.mjs,.txt,.strudel,.mid,.midi,audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aiff,.aif,.opus,.webm';
