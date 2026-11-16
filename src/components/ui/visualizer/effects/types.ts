import type { AudioFrame } from '../audio';
import type { SceneColors } from '../colors';

/** Ein Visualizer-Modus. Zeichnet in CSS-Pixeln (die Szene setzt die DPR-Transformation). */
export interface Effect {
  /** Gewünschte Anzahl Spektrumbänder bei dieser Breite. */
  bandCount(width: number): number;
  resize(width: number, height: number): void;
  /**
   * `colors`: Spurfarben samt Anschlag-Pegeln und Mischfarbe.
   * `alpha` 0…1: Ein-/Ausblenden der ganzen Szene.
   */
  draw(ctx: CanvasRenderingContext2D, audio: AudioFrame, colors: SceneColors, alpha: number): void;
}
