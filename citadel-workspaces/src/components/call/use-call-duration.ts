import { useEffect, useRef, useState , type MutableRefObject } from 'react';

/**
 * A ticking call timer, as mm:ss.
 *
 * Started from the moment the call goes active rather than from when it was
 * dialled, because the number people expect is how long they have been talking,
 * not how long ago they pressed call.
 */
export function useCallDuration(running: boolean): string {
  const startedAt: MutableRefObject<number | null> = useRef<number | null>(null);
  const [text, setText] = useState('00:00');

  useEffect(() => {
    if (!running) {
      startedAt.current = null;
      setText('00:00');
      return;
    }

    startedAt.current = Date.now();
    // One second is the resolution the display has; a faster interval would
    // re-render the call surface for no visible difference.
    const tick = (): void => {
      const started: number | null = startedAt.current;
      if (started === null) return;
      const seconds: number = Math.floor((Date.now() - started) / 1000);
      const mm: string = String(Math.floor(seconds / 60)).padStart(2, '0');
      const ss: string = String(seconds % 60).padStart(2, '0');
      setText(`${mm}:${ss}`);
    };

    tick();
    const timer: number = window.setInterval(tick, 1000);
    return (): void => window.clearInterval(timer);
  }, [running]);

  return text;
}
