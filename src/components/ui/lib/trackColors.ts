import type { TKey } from '../../../i18n';
import type { TrackColor } from '../../../types/ast';

/**
 * Tailwind-Klassen je Spurfarbe. Bewusst ausgeschrieben, damit Tailwind sie beim
 * Scannen findet (keine dynamisch zusammengesetzten Klassennamen).
 */
export interface TrackColorClasses {
  /** Kräftige Fläche (Farbbalken, aktive Raster-Zellen). */
  solid: string;
  /** Hover-Variante für aktive Zellen. */
  solidHover: string;
  /** Dezente Tönung (ausgewählte Spur, Hintergründe). */
  soft: string;
  /** Text in Spurfarbe. */
  text: string;
  /** Rahmen in Spurfarbe. */
  border: string;
  /** Fokus-/Auswahlring in Spurfarbe. */
  ring: string;
  /** Leuchtpunkt-Schatten. */
  glow: string;
}

export const TRACK_COLOR_CLASSES: Record<TrackColor, TrackColorClasses> = {
  violet: {
    solid: 'bg-violet-400',
    solidHover: 'hover:bg-violet-300',
    soft: 'bg-violet-400/10',
    text: 'text-violet-300',
    border: 'border-violet-400/40',
    ring: 'ring-violet-400/70',
    glow: 'shadow-[0_0_12px_rgb(167_139_250/0.55)]',
  },
  sky: {
    solid: 'bg-sky-400',
    solidHover: 'hover:bg-sky-300',
    soft: 'bg-sky-400/10',
    text: 'text-sky-300',
    border: 'border-sky-400/40',
    ring: 'ring-sky-400/70',
    glow: 'shadow-[0_0_12px_rgb(56_189_248/0.55)]',
  },
  emerald: {
    solid: 'bg-emerald-400',
    solidHover: 'hover:bg-emerald-300',
    soft: 'bg-emerald-400/10',
    text: 'text-emerald-300',
    border: 'border-emerald-400/40',
    ring: 'ring-emerald-400/70',
    glow: 'shadow-[0_0_12px_rgb(52_211_153/0.55)]',
  },
  amber: {
    solid: 'bg-amber-400',
    solidHover: 'hover:bg-amber-300',
    soft: 'bg-amber-400/10',
    text: 'text-amber-300',
    border: 'border-amber-400/40',
    ring: 'ring-amber-400/70',
    glow: 'shadow-[0_0_12px_rgb(251_191_36/0.55)]',
  },
  rose: {
    solid: 'bg-rose-400',
    solidHover: 'hover:bg-rose-300',
    soft: 'bg-rose-400/10',
    text: 'text-rose-300',
    border: 'border-rose-400/40',
    ring: 'ring-rose-400/70',
    glow: 'shadow-[0_0_12px_rgb(251_113_133/0.55)]',
  },
  cyan: {
    solid: 'bg-cyan-400',
    solidHover: 'hover:bg-cyan-300',
    soft: 'bg-cyan-400/10',
    text: 'text-cyan-300',
    border: 'border-cyan-400/40',
    ring: 'ring-cyan-400/70',
    glow: 'shadow-[0_0_12px_rgb(34_211_238/0.55)]',
  },
  lime: {
    solid: 'bg-lime-400',
    solidHover: 'hover:bg-lime-300',
    soft: 'bg-lime-400/10',
    text: 'text-lime-300',
    border: 'border-lime-400/40',
    ring: 'ring-lime-400/70',
    glow: 'shadow-[0_0_12px_rgb(163_230_53/0.55)]',
  },
  fuchsia: {
    solid: 'bg-fuchsia-400',
    solidHover: 'hover:bg-fuchsia-300',
    soft: 'bg-fuchsia-400/10',
    text: 'text-fuchsia-300',
    border: 'border-fuchsia-400/40',
    ring: 'ring-fuchsia-400/70',
    glow: 'shadow-[0_0_12px_rgb(232_121_249/0.55)]',
  },
};

/** Übersetzungs-Keys der Farbnamen (statisch → typgeprüft). */
export const TRACK_COLOR_LABEL_KEYS: Record<TrackColor, TKey> = {
  violet: 'ui.colors.violet',
  sky: 'ui.colors.sky',
  emerald: 'ui.colors.emerald',
  amber: 'ui.colors.amber',
  rose: 'ui.colors.rose',
  cyan: 'ui.colors.cyan',
  lime: 'ui.colors.lime',
  fuchsia: 'ui.colors.fuchsia',
};

/** Spurfarben als RGB (die 400er-Töne wie bei `solid`) – für Canvas-Zeichnungen (Visualizer). */
export const TRACK_COLOR_RGB: Record<TrackColor, readonly [number, number, number]> = {
  violet: [167, 139, 250],
  sky: [56, 189, 248],
  emerald: [52, 211, 153],
  amber: [251, 191, 36],
  rose: [251, 113, 133],
  cyan: [34, 211, 238],
  lime: [163, 230, 53],
  fuchsia: [232, 121, 249],
};

export function trackColor(color: TrackColor | undefined): TrackColorClasses {
  return TRACK_COLOR_CLASSES[color ?? 'violet'] ?? TRACK_COLOR_CLASSES.violet;
}
