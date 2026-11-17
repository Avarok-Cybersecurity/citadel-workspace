import { useRef, useState, type DragEvent } from 'react';

export interface ChatFileDrop {
  /** True while a file is being dragged over the target and it would take the drop. */
  dragging: boolean;
  handlers: {
    onDragEnter: (e: DragEvent<HTMLElement>) => void;
    onDragOver: (e: DragEvent<HTMLElement>) => void;
    onDragLeave: (e: DragEvent<HTMLElement>) => void;
    onDrop: (e: DragEvent<HTMLElement>) => void;
  };
}

/** A drag of selected text or a link has no 'Files' entry; only a real file drag does. */
function carriesFiles(e: DragEvent<HTMLElement>): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Whether the event began inside this element's own DOM. React delivers events from a portal
 * (the Send File dialog) to its React ancestors, so a drop inside the dialog would otherwise be
 * taken twice: once by the dialog's own zone and once by the chat behind it.
 */
function isInside(e: DragEvent<HTMLElement>): boolean {
  return e.target instanceof Node && e.currentTarget.contains(e.target);
}

/**
 * Drop handling for a whole region, kept apart from the dialog's own drop zone: that one selects a
 * file inside an open dialog, this one hands the file to the send path.
 *
 * Every file drag is claimed (default prevented), enabled or not. Left unclaimed the browser
 * navigates to the file and the conversation is gone, which is worse than a drop that does nothing.
 *
 * Entering and leaving fire for every child the pointer crosses, so a counter, not a flag, says
 * whether the pointer is still over the region.
 */
export function useChatFileDrop(onFile: (file: File) => void, enabled: boolean): ChatFileDrop {
  const [dragging, setDragging] = useState<boolean>(false);
  const depth: React.MutableRefObject<number> = useRef<number>(0);

  const live = (e: DragEvent<HTMLElement>): boolean => carriesFiles(e) && isInside(e);

  return {
    dragging,
    handlers: {
      onDragEnter: (e: DragEvent<HTMLElement>): void => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        if (!live(e)) return;
        depth.current += 1;
        setDragging(true);
      },
      onDragOver: (e: DragEvent<HTMLElement>): void => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = enabled && isInside(e) ? 'copy' : 'none';
      },
      onDragLeave: (e: DragEvent<HTMLElement>): void => {
        if (!live(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      },
      onDrop: (e: DragEvent<HTMLElement>): void => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (!enabled || !isInside(e)) return;
        const file: File | undefined = e.dataTransfer.files[0];
        if (file) onFile(file);
      },
    },
  };
}
