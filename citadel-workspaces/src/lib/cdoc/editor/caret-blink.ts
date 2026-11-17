/**
 * Whether the local caret is drawn right now: Word's and Chromium's blink, as a state machine
 * over an injected clock (SBIO: no timer here, so tests step it).
 *
 * - Focused and still: visible for one phase, hidden for one, and so on.
 * - Every caret move or keystroke restarts it visible, so the caret never vanishes as you type.
 * - Steady while a drag selects, and steady for prefers-reduced-motion.
 * - Hidden while the document does not have focus.
 *
 * Only the caret's own overlay is shown or hidden; nothing is repainted.
 */

/** Calls `tick` every `ms` until the returned function is called. */
export type Repeat = (ms: number, tick: () => void) => () => void;

export interface BlinkInputs {
  readonly focused: boolean;
  readonly dragging: boolean;
  readonly reducedMotion: boolean;
}

export class CaretBlink {
  private inputs: BlinkInputs = { focused: false, dragging: false, reducedMotion: false };
  private visible: boolean = false;
  private stop: (() => void) | null = null;

  constructor(
    private readonly repeat: Repeat,
    private readonly phaseMs: number,
    private readonly show: (visible: boolean) => void,
  ) {
    if (!(phaseMs > 0)) throw new RangeError(`a blink phase must be positive, got ${phaseMs}`);
  }

  update(inputs: BlinkInputs): void {
    this.inputs = inputs;
    this.restart();
  }

  /** The caret moved or a key was typed: show it now and start a fresh phase. */
  restart(): void {
    this.stop?.();
    this.stop = null;
    const { focused, dragging, reducedMotion } = this.inputs;
    this.set(focused);
    if (focused && !dragging && !reducedMotion) this.stop = this.repeat(this.phaseMs, (): void => this.set(!this.visible));
  }

  dispose(): void {
    this.stop?.();
    this.stop = null;
  }

  private set(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.show(visible);
  }
}
