/**
 * The upload a node channel is sending to the workspace server, and what was last announced about
 * it (server-upload). Held here, not in a toast: the strip under the transcript shows the progress
 * and stays with the outcome until the person dismisses it.
 */
import { useCallback, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { announcement, type ServerUpload } from '@/lib/chat/attachments/server-upload';

export interface ServerUploadView {
  readonly upload: ServerUpload | null;
  /** The live region's text: the last thing worth announcing. */
  readonly announced: string;
  dismiss(): void;
}

export interface ServerUploadControl {
  readonly view: ServerUploadView;
  /** Moves to `next`, announcing it when it is worth announcing. */
  move(next: ServerUpload): void;
}

export function useServerUpload(): ServerUploadControl {
  const current: MutableRefObject<ServerUpload | null> = useRef<ServerUpload | null>(null);
  const [state, setState] = useState<{ upload: ServerUpload | null; announced: string }>({ upload: null, announced: '' });
  const move: (next: ServerUpload) => void = useCallback((next: ServerUpload): void => {
    const said: string | null = announcement(current.current, next);
    current.current = next;
    setState((was: { announced: string }): { upload: ServerUpload; announced: string } => ({ upload: next, announced: said ?? was.announced }));
  }, []);
  const dismiss: () => void = useCallback((): void => {
    current.current = null;
    setState({ upload: null, announced: '' });
  }, []);
  const view: ServerUploadView = useMemo((): ServerUploadView => ({ ...state, dismiss }), [state, dismiss]);
  return { view, move };
}
