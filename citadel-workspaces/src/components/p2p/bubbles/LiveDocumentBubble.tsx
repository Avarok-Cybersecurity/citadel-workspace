import { FileText, Users } from 'lucide-react';
import { getBubbleStyles, BUBBLE_MAX_WIDTH , type LiveDocumentBubbleProps } from './types';
import { BubbleFooter } from './BubbleFooter';

export function LiveDocumentBubble({ message, isOwn, onRetry, onOpenDocument }: LiveDocumentBubbleProps): JSX.Element {
  const isFailed: boolean = message.status === 'failed';
  const bubbleStyles: string = getBubbleStyles(isOwn, isFailed);

  const handleClick = (): void => {
    if (message.document_id && onOpenDocument) {
      // The message's sender made the document: what decides whose move of an earlier one is kept.
      onOpenDocument({ documentId: message.document_id, title: message.document_title || 'Untitled Document', mine: isOwn });
    }
  };

  return (
    <div className={`${BUBBLE_MAX_WIDTH} rounded-lg px-3 py-2 ${bubbleStyles}`}>
      <button
        onClick={handleClick}
        className="w-full text-left hover:opacity-90 transition-opacity"
        disabled={!message.document_id}
      >
        <div className="flex items-center gap-2 mb-1">
          <div className="p-1.5 rounded bg-foreground/10">
            <FileText className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">
              {message.document_title || 'Untitled Document'}
            </p>
            <div className="flex items-center gap-1 text-xs opacity-90">
              <Users className="h-3 w-3" />
              <span>Live Document</span>
            </div>
          </div>
        </div>
        <p className="text-xs opacity-90 mt-1">
          Click to open and edit collaboratively
        </p>
      </button>
      <BubbleFooter message={message} isOwn={isOwn} onRetry={onRetry} />
    </div>
  );
}
