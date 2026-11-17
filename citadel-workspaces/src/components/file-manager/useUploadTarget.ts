/**
 * Which folder the files just picked belong in.
 *
 * This was `useState('/')`, set by `handleUploadFile` just before it opened the
 * picker. The open folder was never consulted: a selection that reached the
 * hidden input without that exact click-then-set sequence landed in Root, with
 * the folder the user was looking at still saying "This folder is empty". The
 * target was a second copy of `currentPath` with a default of its own.
 *
 * Now the open folder IS the target, unless an action named a different folder
 * for this one pick (a folder's own context menu). That choice is used once and
 * forgotten on navigation, so it cannot outlive the view it was made in.
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';

export interface UploadTarget {
  /** Name the folder the picker about to open is for. */
  choose: (dir: string) => void;
  /** The folder a selection belongs in; consumes any `choose`. */
  take: () => string;
}

export function useUploadTarget(currentPath: string): UploadTarget {
  const chosen: MutableRefObject<string | null> = useRef<string | null>(null);

  useEffect((): void => {
    chosen.current = null;
  }, [currentPath]);

  const choose: (dir: string) => void = useCallback((dir: string): void => {
    chosen.current = dir;
  }, []);

  const take: () => string = useCallback((): string => {
    const dir: string = chosen.current ?? currentPath;
    chosen.current = null;
    return dir;
  }, [currentPath]);

  return { choose, take };
}
