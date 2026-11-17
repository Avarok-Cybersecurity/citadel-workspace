/**
 * The one chat pane: a direct chat, a node channel and a peer group all render here.
 *
 * Text and markdown, live documents in tabs, files, replies, edits, reactions, ticks, retry,
 * drafts and history paging are the direct chat's, extracted unchanged. What a conversation can
 * do comes from its transport (lib/chat/transport): a control whose port is absent is not shown,
 * so nothing here answers "not available in this chat". Only what sits above the tabs differs
 * between kinds (a peer's connection header, a channel's roster), and the caller supplies it.
 */
import { useMemo, type ReactNode } from 'react';
import type { PeerPresence } from '@/lib/p2p';
import { restrictionText } from '@/components/chat/group-restriction';
import { NewMessagesPill } from '@/components/chat/NewMessagesPill';
import { ChatTabBar } from '@/components/p2p/ChatTabBar';
import { ComposeContextBanner } from '@/components/p2p/ComposeContextBanner';
import { ChatDocumentPane } from '@/components/p2p/chat-document/ChatDocumentPane';
import type { ChatDocumentOpening } from '@/components/p2p/chat-document/chat-document-opening';
import { LiveDocumentModal } from '@/components/p2p/LiveDocumentModal';
import { ChatFileDialogs } from '@/components/p2p/ChatFileDialogs';
import { ChatDropTarget } from '@/components/p2p/ChatDropTarget';
import { ChatSettingsPanel } from '@/components/p2p/ChatSettingsPanel';
import type { PauseView } from '@/components/p2p/hooks/use-peer-pause';
import type { ChatTransport } from '@/lib/chat/transport/chat-transport';
import { MessageList } from './MessageList';
import { AttachmentIOContext, type AttachmentIO } from '@/components/chat/attachments/attachment-io';
import type { SharedFile } from '@/lib/chat/attachments/shared-file';
import { browserDocumentFiles } from '@/lib/document-files';
import { ServerUploadStatus } from '@/components/chat/attachments/ServerUploadStatus';
import { MessageInput } from './MessageInput';
import { paneTestIds, type PaneTestIds } from './pane-test-ids';
import { useChatPane, type ChatPaneModel } from './use-chat-pane';

const NO_ACCOUNT: ChatDocumentOpening = { kind: 'unmoved', reason: { kind: 'no-account' }, loadOriginal: null };

/** What the pane knows that the part above its tabs shows. */
export interface ChatPaneStatus {
  /** Who is typing now, by name. */
  readonly typing: readonly string[];
  readonly presence: PeerPresence | null;
  readonly connected: boolean;
  /** The counterpart has accepted (always, where no one has to). */
  readonly accepted: boolean;
  /** Opens the conversation's settings; null where it has none. */
  readonly openSettings: (() => void) | null;
}

interface ChatPaneProps {
  transport: ChatTransport;
  /** Everything above the tabs: the header, its banners and a docked call. */
  header: (status: ChatPaneStatus) => ReactNode;
  /** The link's pause state where the conversation can be paused; null where it cannot. */
  pause: PauseView | null;
}

export function ChatPane({ transport, header, pause }: ChatPaneProps): JSX.Element {
  const pane: ChatPaneModel = useChatPane(transport, pause);
  const read: ((file: SharedFile) => Promise<Uint8Array>) | null = transport.files?.read ?? null;
  const attachmentIO: AttachmentIO | null = useMemo((): AttachmentIO | null => (read === null ? null : { read, files: browserDocumentFiles }), [read]);
  const { tabs, messages: list, compose, fileSend } = pane;
  const ids: PaneTestIds = paneTestIds(transport.kind);
  const { counterpart, features, self } = transport;
  const awaitingAcceptFrom: string | null = list.isRegistered ? null : counterpart.name; // held until then
  const viewedDocument: string | null = tabs.activeTab?.type === 'live_document' && tabs.activeTab.documentId ? tabs.activeTab.documentId : null;
  const restricted: string | null = restrictionText(pane.sendGate, 'send messages');

  return (
    <AttachmentIOContext.Provider value={attachmentIO}>
    <ChatDropTarget className="h-full flex flex-col bg-background" testId={ids.root['data-testid']} recipient={counterpart.name} hint="Only the first file is sent. You can cancel it from the conversation." {...fileSend.drop}>
      {header({
        typing: list.typing, presence: list.peerPresence, connected: list.isConnected, accepted: list.isRegistered,
        openSettings: transport.settings === null ? null : (): void => pane.setSettingsOpen(true),
      })}
      <ChatTabBar tabs={tabs.tabsWithUnread} activeTabId={tabs.activeTabId} onTabSelect={tabs.handleTabSelect} onTabClose={tabs.handleCloseTab} onTabRename={tabs.handleRenameDocument} renamable={tabs.renamable} />

      <div className="flex-1 p-0 flex flex-col overflow-hidden">
        {viewedDocument !== null && tabs.activeTab ? (
          <ChatDocumentPane
            key={viewedDocument} docId={viewedDocument} title={tabs.activeTab.title} peerName={counterpart.name} sharedWith={transport.documents?.sharedWith ?? ''} selfName={self?.displayName ?? 'You'}
            opening={self === null ? NO_ACCOUNT : tabs.documents.get(viewedDocument) ?? null}
            onRetry={(): void => tabs.retryDocument(viewedDocument)}
            onRename={(title: string): Promise<void> => tabs.handleRenameDocument(viewedDocument, title)}
          />
        ) : (
          <>
            <div className="relative flex min-h-0 flex-1 flex-col" {...ids.log}>
            <MessageList
              ref={pane.scrollRef} messages={list.messages} greeting={counterpart.greeting} namesSenders={features.namesSenders}
              selfCid={self?.cid ?? null} reactorName={transport.reactorName} awaitingAcceptFrom={awaitingAcceptFrom}
              isLoadingMore={list.isLoadingMore} isLoadingHistory={list.isLoadingHistory} hasMorePages={list.hasMorePages}
              onLoadOlder={(): void => { void list.loadOlderMessages(); }} olderPagesError={list.olderPagesError}
              onScroll={list.handleScroll} onRetryMessage={list.handleRetryMessage}
              onOpenDocument={tabs.handleOpenDocument}
              onAcceptTransfer={fileSend.fileTransfer.handleAcceptTransfer}
              onDeclineTransfer={fileSend.fileTransfer.handleDeclineTransfer}
              onCancelTransfer={fileSend.fileTransfer.handleCancelTransfer}
              onOpenFile={fileSend.fileTransfer.handleOpenFile}
              onEditMessage={features.revise ? compose.handleStartEdit : null}
              onDeleteMessage={features.revise ? list.handleDeleteMessage : null}
              onReplyMessage={compose.handleReplyMessage}
              focusComposer={(): void => { compose.inputRef.current?.focus(); }}
              onReactMessage={features.reactions ? list.handleReactMessage : null}
            />
            <NewMessagesPill count={pane.stick.unseen} onView={pane.stick.reveal} />
            </div>
            <ServerUploadStatus view={fileSend.fileTransfer.upload} />
            <ComposeContextBanner replyingTo={compose.replyingTo} editingMessage={compose.editingMessage} onCancel={compose.cancelComposeContext} />
            {restricted !== null ? (
              // A role without the permission gets the reason, not a box that silently refuses.
              <div className="p-4 border-t border-border">
                <p className="text-sm text-muted-foreground" {...ids.restricted}>{restricted}</p>
              </div>
            ) : (
              <MessageInput
                ref={compose.inputRef} features={features} testId={ids.input['data-testid']}
                inputMessage={compose.inputMessage} messageType={compose.messageType}
                showMarkdownPreview={compose.showMarkdownPreview} paused={pane.paused} isSending={compose.isSending} awaitingAcceptFrom={awaitingAcceptFrom}
                onInputChange={compose.setInputMessage} onInputFocus={compose.handleInputFocus}
                onInputBlur={compose.handleInputBlur} onSubmit={compose.handleSendMessage}
                onFileClick={fileSend.openDialog} onFormat={compose.applyFormat} fileDestination={transport.files?.destination ?? null}
                onTogglePreview={(): void => compose.setShowMarkdownPreview((prev: boolean): boolean => !prev)}
                onMessageTypeChange={compose.handleMessageTypeChange}
              />
            )}
          </>
        )}
      </div>

      <LiveDocumentModal isOpen={compose.showDocModal} onClose={compose.closeDocModal} onCreateDocument={compose.handleDocCreate} initialContent={compose.inputMessage} />
      {transport.files !== null && <ChatFileDialogs send={fileSend} files={transport.files} picker={ids.picker} peerName={counterpart.name} />}
      {transport.settings !== null && (
        <ChatSettingsPanel isOpen={pane.settingsOpen} onClose={(): void => pane.setSettingsOpen(false)} peerCid={transport.settings.key} peerName={counterpart.name} />
      )}
    </ChatDropTarget>
    </AttachmentIOContext.Provider>
  );
}
