/**
 * Message composition state for P2PChat.
 *
 * Owns everything about the message being written: the input text and its
 * focus/typing signals, the message type, markdown formatting/preview, the
 * reply/edit compose context, the send flow, and the live-document creation
 * hand-off. Split from P2PChat.tsx (alongside useP2PMessages / useP2PTabs /
 * useP2PFileTransfer) so the component composes hooks instead of owning the
 * composer state machine itself.
 */

import { useState, useEffect, useRef, useCallback , type RefObject ,  type MutableRefObject } from 'react';
// No clearDraft here: every send path already does setInputMessage(''), and
// saveDraft treats an empty string as "no draft" and deletes the entry. A
// second way to clear it would be a second thing to keep in step with the first.
import { loadDraft, saveDraft } from '@/lib/chat/draft-store';
import { describeFailure } from '@/lib/failure-message';
import type { ChatMessage, ChatTransport, TextSend } from '@/lib/chat/transport/chat-transport';
import { useToast } from '@/hooks/use-toast';
import { debugLog } from '@/lib/debug-config';
import { useMarkdownFormat } from '../MarkdownToolbar';
import type { MessageType } from '@/types/message-protocol';
import type { Dispatch, SetStateAction } from 'react';
import type { NewChatDocumentInput } from '../LiveDocumentModal';
import type { ChatDocumentMade } from './useP2PTabs';

interface UseP2PComposeParams {
  transport: ChatTransport;
  messages: ChatMessage[];
  /** Commits an edit through the messages hook. */
  editMessage: (messageId: string, content: string) => Promise<void>;
  /** Creates a live document through the tabs hook. */
  createDocument: (input: NewChatDocumentInput) => Promise<ChatDocumentMade>;
}

/** What the composer sends as a message; a Live Doc goes through its dialog instead. */
function textKind(type: MessageType): TextSend['messageType'] {
  if (type === 'text' || type === 'markdown') return type;
  throw new Error(`A ${type} message is not typed into the composer`);
}

export function useP2PCompose({ transport, messages, editMessage, createDocument }: UseP2PComposeParams): { inputRef: RefObject<HTMLTextAreaElement>; inputMessage: string; setInputMessage: Dispatch<SetStateAction<string>>; isSending: boolean; messageType: MessageType; showDocModal: boolean; closeDocModal: () => void; showMarkdownPreview: boolean; setShowMarkdownPreview: Dispatch<SetStateAction<boolean>>; applyFormat: (format: string, prefix: string, suffix: string) => void; replyingTo: ChatMessage | null; editingMessage: ChatMessage | null; handleReplyMessage: (messageId: string) => void; handleStartEdit: (messageId: string, content: string) => void; cancelComposeContext: () => void; handleSendMessage: () => Promise<void>; handleDocCreate: (input: NewChatDocumentInput) => Promise<void>; handleMessageTypeChange: (type: MessageType) => void; handleInputFocus: () => void; handleInputBlur: () => void; } {
  // Seeded from the draft store, so switching conversations and coming back
  // returns what was typed. The chat is keyed by peer — that keying is the fix
  // for drafts LEAKING between conversations, and it is why the text has to
  // live outside the component to survive the remount.
  const { conversationKey, send, status } = transport;
  const [inputMessage, setInputMessage] = useState(() => loadDraft(conversationKey));
  // True between submit and the message appearing in the transcript. The group
  // composer has had this guard since it was written; the P2P one never did, so
  // a second Enter during the send window sent a genuine duplicate.
  const [isSending, setIsSending] = useState(false);
  const inputRef: RefObject<HTMLTextAreaElement> = useRef<HTMLTextAreaElement>(null);
  const inputMessageRef: MutableRefObject<string> = useRef(inputMessage);

  const [messageType, setMessageType] = useState<MessageType>('text');
  const [showDocModal, setShowDocModal] = useState(false);
  const [showMarkdownPreview, setShowMarkdownPreview] = useState(false);

  const { toast } = useToast();
  const applyFormat: (format: string, prefix: string, suffix: string) => void = useMarkdownFormat(inputRef, setInputMessage, (): string => inputMessage);

  useEffect(() => { inputMessageRef.current = inputMessage; }, [inputMessage]);

  // Written on every change rather than on unmount: a tab close, a crash or a
  // navigation that skips cleanup all lose an unmount-only save, and those are
  // exactly the moments a draft matters.
  useEffect(() => {
    saveDraft(conversationKey, inputMessage);
  }, [conversationKey, inputMessage]);

  // The message this composition is replying to, if any. Cleared on send and on
  // explicit cancel, so a reply cannot silently attach itself to a later message.
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);

  // The message being edited. The bubble's Edit action hands us the CURRENT
  // content, so it cannot be an edit on its own — it loads the message into the
  // composer and the next submit commits the change.
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);

  const handleReplyMessage: (messageId: string) => void = useCallback((messageId: string): void => {
    const target: ChatMessage | undefined = messages.find((m) => m.id === messageId);
    if (!target) return;
    setEditingMessage(null);
    setReplyingTo(target);
    inputRef.current?.focus();
  }, [messages]);

  const handleStartEdit: (messageId: string, content: string) => void = useCallback((messageId: string, content: string): void => {
    const target: ChatMessage | undefined = messages.find((m) => m.id === messageId);
    if (!target) return;
    setReplyingTo(null);
    setEditingMessage(target);
    setInputMessage(content);
    inputRef.current?.focus();
  }, [messages]);

  const cancelComposeContext: () => void = useCallback((): void => {
    if (editingMessage) setInputMessage('');
    setEditingMessage(null);
    setReplyingTo(null);
  }, [editingMessage]);

  const handleSendMessage = async (): Promise<void> => {
    if (isSending) return;
    // Before the empty check: a Live Doc takes its title and seed from the dialog, not from the
    // box, so an empty box is no reason to do nothing.
    if (messageType === 'live_document') { setShowDocModal(true); return; }
    if (!inputMessage.trim()) return;
    status?.stopTyping();
    setIsSending(true);
    try {
      if (editingMessage) {
        await editMessage(editingMessage.id, inputMessage);
        setEditingMessage(null);
        setInputMessage('');
        return;
      }
      await send.text({
        content: inputMessage,
        messageType: textKind(messageType),
        replyTo: replyingTo?.id ?? null,
        // Clears the composer the moment the bubble exists, rather than when
        // the network round trip finishes. Failures BEFORE that point leave
        // no bubble to retry from, so the text has to survive them.
        onRecorded: () => {
          setInputMessage('');
          setReplyingTo(null);
          setIsSending(false);
        },
      });
    } catch (error) {
      debugLog('P2PChat', 'Failed to send message:', error);
      toast({ variant: 'destructive', title: 'Failed to send message', description: describeFailure(error, 'Check your connection and try again.') });
    } finally {
      setIsSending(false);
    }
  };


  // Back to text whichever way the dialog ends. Only handleMessageTypeChange
  // ever changed the type, so after a Live Doc was created or cancelled the
  // next Enter reopened the dialog instead of sending what was typed.
  const closeDocModal: () => void = useCallback((): void => {
    setShowDocModal(false);
    setMessageType('text');
  }, []);

  const handleDocCreate: (input: NewChatDocumentInput) => Promise<void> = useCallback(async (input: NewChatDocumentInput): Promise<void> => {
    const { delivered }: ChatDocumentMade = await createDocument(input);
    closeDocModal();
    setInputMessage('');
    // The document is open by now; its invitation's bubble shows the failure and offers the retry.
    void delivered.catch((error: unknown): void => {
      toast({ variant: 'destructive', title: 'The invitation was not delivered', description: describeFailure(error, 'Retry it from the conversation.') });
    });
  }, [createDocument, closeDocModal, toast]);

  const handleMessageTypeChange: (type: MessageType) => void = useCallback((type: MessageType): void => {
    setMessageType(type);
    if (type === 'live_document') setShowDocModal(true);
  }, []);

  const handleInputFocus: () => void = useCallback((): void => {
    status?.startTyping(() => inputMessageRef.current);
  }, [status]);

  const handleInputBlur: () => void = useCallback((): void => {
    status?.stopTyping();
  }, [status]);

  return {
    inputRef, inputMessage, setInputMessage, isSending,
    messageType, showDocModal, closeDocModal,
    showMarkdownPreview, setShowMarkdownPreview,
    applyFormat,
    replyingTo, editingMessage,
    handleReplyMessage, handleStartEdit, cancelComposeContext,
    handleSendMessage, handleDocCreate, handleMessageTypeChange,
    handleInputFocus, handleInputBlur,
  };
}
