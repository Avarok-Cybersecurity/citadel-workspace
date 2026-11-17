/**
 * MessageInput Component
 *
 * The chat pane's composer: markdown toolbar and preview, the attach button and the type
 * selector, each shown only where the conversation's transport can carry it.
 */

import React, { forwardRef, useId } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { shouldSendOnKey } from '@/components/chat/should-send-on-key';
import { Button } from '@/components/ui/button';
import { Send, Paperclip } from 'lucide-react';
import { MarkdownToolbar } from '@/components/p2p/MarkdownToolbar';
import { TypeSelectorBar } from '@/components/p2p/TypeSelectorBar';
import ReactMarkdown, { type Components } from 'react-markdown';
import { documentAnchor } from '@/components/shared/DocumentLink';
import type { MessageType } from '@/types/message-protocol';
import { PAUSE_COPY } from '@/lib/p2p-pause/pause-copy';
import { awaitingAcceptPlaceholder } from '@/components/p2p/bubbles/awaiting-accept';
import type { ChatFeatures } from '@/lib/chat/transport/features';

/**
 * The preview had NO component map, so its links fell through to
 * react-markdown's built-in anchor: no router, no `rel`. Previewing your own
 * message and clicking a link to another workspace page reloaded the whole app
 * — the one place the author is most likely to click a link to check it works.
 */
const previewComponents: Components = { a: documentAnchor };

/** The kinds of message a composer offers, from what the conversation can carry. */
export function offeredTypes(features: Pick<ChatFeatures, 'markdown' | 'documents'>): MessageType[] {
  return [
    'text',
    ...(features.markdown ? ['markdown' as const] : []),
    ...(features.documents ? ['live_document' as const] : []),
  ];
}

interface MessageInputProps {
  /** What the conversation can carry: the selector offers only these, and attach needs files. */
  features: Pick<ChatFeatures, 'markdown' | 'documents' | 'files'>;
  /** The composer's test address, which specs of each kind of chat already use. */
  testId: string;
  inputMessage: string;
  messageType: MessageType;
  showMarkdownPreview: boolean;
  /** Paused: messages still send (they queue); files need the live link. */
  paused: boolean;
  /** A message is between submit and appearing in the transcript. */
  isSending: boolean;
  /** The peer's name while they have not accepted: messages are held until they do; files need the link. */
  awaitingAcceptFrom: string | null;
  onInputChange: (value: string) => void;
  onInputFocus: () => void;
  onInputBlur: () => void;
  onSubmit: () => void;
  onFileClick: () => void;
  /** Where an attached file goes and who can read it, said under the composer; null without files. */
  fileDestination: string | null;
  onFormat: (format: string, prefix: string, suffix: string) => void;
  onTogglePreview: () => void;
  onMessageTypeChange: (type: MessageType) => void;
}

export const MessageInput: React.ForwardRefExoticComponent<MessageInputProps & React.RefAttributes<HTMLTextAreaElement>> = forwardRef<HTMLTextAreaElement, MessageInputProps>(
  function MessageInput(
    {
      features,
      testId,
      inputMessage,
      messageType,
      showMarkdownPreview,
      paused,
      isSending,
      awaitingAcceptFrom,
      onInputChange,
      onInputFocus,
      onInputBlur,
      onSubmit,
      onFileClick,
      fileDestination,
      onFormat,
      onTogglePreview,
      onMessageTypeChange,
    }: MessageInputProps,
    ref: React.ForwardedRef<HTMLTextAreaElement>
  ) {
    const destinationId: string = useId();
    const showsDestination: boolean = features.files && fileDestination !== null;
    const isMarkdownMode: boolean = messageType === 'markdown';
    const isLiveDocMode: boolean = messageType === 'live_document';

    const handleSubmit = (e: React.FormEvent): void => {
      e.preventDefault();
      onSubmit();
    };

    const getPlaceholder: () => string = (): string => {
      if (awaitingAcceptFrom !== null) return awaitingAcceptPlaceholder(awaitingAcceptFrom);
      if (paused) return PAUSE_COPY.composerPlaceholder;
      if (isMarkdownMode) return 'Type markdown message...';
      if (isLiveDocMode) return 'Document content (optional)...';
      return 'Type a message...';
    };

    return (
      <div className="border-t border-border bg-background">
        <MarkdownToolbar
          visible={isMarkdownMode}
          onFormat={onFormat}
          showPreview={showMarkdownPreview}
          onTogglePreview={onTogglePreview}
        />

        {isMarkdownMode && showMarkdownPreview && inputMessage.trim() && (
          <div className="p-4 border-b border-border bg-background">
            <p className="text-xs text-muted-foreground mb-2">Preview:</p>
            <div className="prose prose-sm dark:prose-invert max-w-none bg-surface rounded-lg p-3 max-h-32 overflow-y-auto">
              <ReactMarkdown components={previewComponents}>{inputMessage}</ReactMarkdown>
            </div>
          </div>
        )}

        <div className="p-4">
          <form onSubmit={handleSubmit} className="flex gap-2">
            {features.files && <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={onFileClick}
              disabled={paused || awaitingAcceptFrom !== null}
              className="h-[44px] w-[44px] shrink-0 text-muted-foreground hover:text-foreground hover:bg-foreground/10"
              aria-label="Send file"
              data-testid="p2p-send-file"
              aria-describedby={showsDestination ? destinationId : undefined}
              title={paused ? PAUSE_COPY.fileReason : 'Send file'}
            >
              <Paperclip className="h-4 w-4" />
            </Button>}
            {/* A textarea, matching the group composer.
                This was an <input> inside a form: Enter submitted natively,
                Shift+Enter could do nothing, and pasted newlines collapsed —
                so the first time somebody pasted a log excerpt or wrote two
                paragraphs to a DM, the product flattened it, while the SAME
                product handled it correctly one screen away. */}
            <Textarea
              ref={ref}
              value={inputMessage}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (shouldSendOnKey(e)) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              onFocus={onInputFocus}
              onBlur={onInputBlur}
              placeholder={getPlaceholder()}
              // Addressed by id. When this became a Textarea -- the right
              // change; an <input> flattened pasted newlines -- every spec
              // still looked for `input[placeholder*="message"]`, which a
              // textarea is not. The warmup messages that every call and
              // reconnection test sends first have been going nowhere since,
              // reported as "not delivered", which reads as a protocol fault.
              data-testid={testId}
              rows={1}
              className="flex-1 resize-none bg-background text-foreground placeholder:text-muted-foreground focus:border-primary"
            />
            <Button
              type="submit"
              size="icon"
              // Icon-only, so it needs a name of its own: axe reports
              // `critical button-name` without it and a screen reader
              // announces nothing at all.
              aria-label="Send message"
              data-testid="chat-send"
              // isSending is the guard against a second Enter during the
              // send window -- peer registration and CheckState can take tens
              // of seconds, and the text is still in the field for all of it.
              disabled={isSending || (!inputMessage.trim() && !isLiveDocMode)}
              aria-busy={isSending}
              className="h-[44px] w-[44px] shrink-0 bg-primary text-primary-foreground"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </Button>
          </form>
          {showsDestination && (
            <p id={destinationId} className="mt-1 text-xs text-muted-foreground" data-testid="attach-destination">{fileDestination}</p>
          )}
        </div>

        {offeredTypes(features).length > 1 && (
          <TypeSelectorBar
            offered={offeredTypes(features)}
            selectedType={messageType}
            onTypeChange={onMessageTypeChange}
          />
        )}
      </div>
    );
  }
);
