/**
 * The local caret's blink for one editable view (CaretBlink, over the clock the caller hands
 * in): whether to show the caret overlay now. Restarted visible whenever `moved` changes, which
 * the caller makes the editor state, so every caret move and keystroke shows the caret at once.
 */
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { CaretBlink, type Repeat } from '@/lib/cdoc/editor/caret-blink';

export interface CaretBlinkOptions {
  readonly phaseMs: number;
  readonly repeat: Repeat;
  /** prefers-reduced-motion: the caret stays steady. */
  readonly reducedMotion: boolean;
}

export function useCaretBlink(options: CaretBlinkOptions, focused: boolean, dragging: boolean, moved: unknown): boolean {
  const [shown, setShown] = useState<boolean>(false);
  const blink: MutableRefObject<CaretBlink | null> = useRef<CaretBlink | null>(null);
  const { phaseMs, repeat, reducedMotion } = options;

  useEffect((): (() => void) => {
    const b: CaretBlink = new CaretBlink(repeat, phaseMs, setShown);
    blink.current = b;
    return (): void => {
      b.dispose();
      blink.current = null;
    };
  }, [repeat, phaseMs]);

  useEffect((): void => {
    blink.current?.update({ focused, dragging, reducedMotion });
  }, [focused, dragging, reducedMotion, repeat, phaseMs]);

  useEffect((): void => {
    blink.current?.restart();
  }, [moved]);

  return shown;
}
