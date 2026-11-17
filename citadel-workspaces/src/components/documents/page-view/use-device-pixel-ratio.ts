/**
 * The screen's devicePixelRatio, kept current: it changes when a window moves between a 1x
 * and a 2x display, or with browser zoom. The only place the page view reads it.
 */
import { useEffect, useState } from 'react';

function read(): number {
  return window.devicePixelRatio;
}

export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState<number>(read);
  useEffect((): (() => void) => {
    const query: MediaQueryList = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const update = (): void => setDpr(read());
    query.addEventListener('change', update);
    return (): void => query.removeEventListener('change', update);
  }, [dpr]);
  return dpr;
}
