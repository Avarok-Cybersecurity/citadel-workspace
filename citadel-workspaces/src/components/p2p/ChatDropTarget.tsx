import type { ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatFileDrop, type ChatFileDrop } from './useChatFileDrop';

interface ChatDropTargetProps {
  onFile: (file: File) => void;
  /** Why a drop cannot land right now (words for the overlay), or null when it can. The drag is claimed either way. */
  unavailable: string | null;
  /** Who the file goes to, as the overlay names them ("Drop a file to send it to …"). */
  recipient: string;
  /** The line under the prompt when a drop can land: what happens to the file. */
  hint: string;
  className: string;
  testId: string;
  children: ReactNode;
}

/**
 * The whole conversation as one drop target.
 *
 * The overlay is decoration for people who can see it and is hidden from assistive technology;
 * the status region carries the same words for those who cannot. The region is always mounted, so
 * filling it is announced -- one created together with its text is announced inconsistently.
 * Keyboard users have the paperclip, which sends through the same path.
 */
export function ChatDropTarget({ onFile, unavailable, recipient, hint, className, testId, children }: ChatDropTargetProps): JSX.Element {
  const { dragging, handlers }: ChatFileDrop = useChatFileDrop(onFile, unavailable === null);
  const prompt: string = unavailable ?? `Drop a file to send it to ${recipient}`;
  return (
    <div className={cn('relative', className)} data-testid={testId} {...handlers}>
      {children}
      {dragging && (
        <div
          aria-hidden="true"
          data-testid="chat-drop-overlay"
          className="pointer-events-none absolute inset-2 z-40 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary-accent bg-background/90 text-center"
        >
          <Upload className="h-8 w-8 text-primary-accent" aria-hidden="true" />
          <p className="text-base font-medium text-foreground">{prompt}</p>
          {unavailable === null && <p className="text-sm text-muted-foreground">{hint}</p>}
        </div>
      )}
      <div role="status" className="sr-only">{dragging ? prompt : ''}</div>
    </div>
  );
}
