/**
 * useP2PTabs Hook
 *
 * Manages the tab system for P2PChat: the messages tab, a tab per document opened in the chat
 * (each a Citadel Docs canvas kept live with the peer: chat-document/), tab activity
 * indicators, and tab open/close/select/rename.
 */

import { useState, useEffect, useRef, useCallback, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import { validateDocTitle, type TitleCheck } from '@/lib/live-document-store/doc-title';
import { newChatDocumentId } from '@/lib/p2p/chat-document-id';
import { citadelApp, creatableIn } from '@/lib/citadel-apps/registry';
import { ChatTab, MESSAGES_TAB, createLiveDocumentTab } from '../ChatTabBar';
import type { NewChatDocumentInput } from '../LiveDocumentModal';
import type { ChatDocumentOpening, ChatDocumentTarget, OpeningPorts } from '../chat-document/chat-document-opening';
import { useChatDocuments, type ChatDocuments } from '../chat-document/use-chat-documents';
import type { DocumentPort } from '@/lib/chat/transport/chat-transport';

/** A chat document made and open. `delivered` settles with its invitation's send; a failure there has a bubble. */
export interface ChatDocumentMade {
  delivered: Promise<void>;
}

/** A document a chat message names: its id, its title, and whether the reader sent the message (made it). */
export interface ChatDocumentLink {
  readonly documentId: string;
  readonly title: string;
  readonly mine: boolean;
}

interface Invitation {
  /** The invitation is in the conversation, or its send settled first. */
  recorded: Promise<void>;
  delivered: Promise<void>;
}

/** A send split where its message is recorded: after that point a failure has a bubble to show it on. */
function whenRecorded(send: (onRecorded: () => void) => Promise<unknown>): Invitation {
  let markRecorded: () => void = (): void => undefined;
  const recordedSignal: Promise<void> = new Promise<void>((resolve: () => void): void => { markRecorded = resolve; });
  const delivered: Promise<void> = send((): void => markRecorded()).then((): void => undefined);
  return { recorded: Promise.race([recordedSignal, delivered]), delivered };
}

/** Opens nothing: a conversation without a document port shows no document control to reach it. */
const NO_OPENING: OpeningPorts = {
  opener: (): never => { throw new Error('This conversation has no live documents'); },
  migration: (): never => { throw new Error('This conversation has no live documents'); },
  report: (): void => undefined,
};

interface UseP2PTabsOptions {
  /** Null where the conversation has no live documents. */
  documents: DocumentPort | null;
  currentUserCid: bigint | undefined;
}

export interface P2PTabs {
  activeTabId: string;
  activeTabIdRef: MutableRefObject<string>;
  tabsWithUnread: (ChatTab & { hasUnread: boolean })[];
  activeTab: ChatTab | undefined;
  /** The opening of each document tab (null while it opens). */
  documents: ReadonlyMap<string, ChatDocumentOpening | null>;
  setMessagesHasUnread: Dispatch<SetStateAction<boolean>>;
  handleTabSelect: (tabId: string) => void;
  handleCloseTab: (tabId: string) => void;
  handleOpenDocument: (link: ChatDocumentLink) => void;
  handleCreateDocument: (input: NewChatDocumentInput) => Promise<ChatDocumentMade>;
  handleRenameDocument: (documentId: string, title: string) => Promise<void>;
  /** Whether a document opened with a rename to offer. */
  renamable: (documentId: string) => boolean;
  retryDocument: (documentId: string) => void;
}

export function useP2PTabs({ documents: port, currentUserCid }: UseP2PTabsOptions): P2PTabs {
  const [tabs, setTabs] = useState<ChatTab[]>([MESSAGES_TAB]);
  const [activeTabId, setActiveTabId] = useState('messages');
  const [messagesHasUnread, setMessagesHasUnread] = useState(false);
  const [tabActivity, setTabActivity] = useState<Record<string, boolean>>({});
  const activeTabIdRef: MutableRefObject<string> = useRef(activeTabId);
  const tabsRef: MutableRefObject<ChatTab[]> = useRef(tabs);
  const documents: ChatDocuments = useChatDocuments(port?.opening ?? NO_OPENING);

  useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);

  // A tab not in front lights up when someone else changes its document.
  useEffect(() => port?.onActivity((docId: string): void => {
    const tab: ChatTab | undefined = tabsRef.current.find(t => t.documentId === docId);
    if (tab && activeTabIdRef.current !== tab.id) setTabActivity(prev => ({ ...prev, [tab.id]: true }));
  }), [port]);

  // The tab's title follows the document's, whoever renamed it.
  useEffect(() => {
    const unsubscribe: (() => void)[] = [];
    for (const [docId, opening] of documents.openings) {
      if (opening?.kind !== 'canvas') continue;
      const follow = (): void => {
        const title: string = opening.document.title.get();
        setTabs(prev => prev.map(t => (t.documentId === docId && t.title !== title ? { ...t, title } : t)));
      };
      follow();
      unsubscribe.push(opening.document.title.subscribe(follow));
    }
    return (): void => { for (const stop of unsubscribe) stop(); };
  }, [documents.openings]);

  const handleTabSelect: (tabId: string) => void = useCallback((tabId: string): void => {
    setActiveTabId(tabId);
    if (tabId === 'messages') setMessagesHasUnread(false);
    setTabActivity(prev => ({ ...prev, [tabId]: false }));
  }, []);

  const handleCloseTab: (tabId: string) => void = useCallback((tabId: string): void => {
    setTabs(prev => prev.filter(t => t.id !== tabId));
    if (activeTabId === tabId) setActiveTabId('messages');
  }, [activeTabId]);

  const { open: openDocument } = documents;
  const showDocument: (target: Omit<ChatDocumentTarget, 'selfCid'>) => void = useCallback((target: Omit<ChatDocumentTarget, 'selfCid'>): void => {
    // Without an account the pane says so (P2PChat); there is nothing to open it as.
    if (currentUserCid !== undefined) openDocument({ ...target, selfCid: currentUserCid });
    const existingTab: ChatTab | undefined = tabsRef.current.find(t => t.documentId === target.docId);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }
    const newTab: ChatTab = createLiveDocumentTab(target.docId, target.title);
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [currentUserCid, openDocument]);

  const handleOpenDocument: (link: ChatDocumentLink) => void = useCallback(({ documentId, title, mine }: ChatDocumentLink): void => {
    if (port === null) return;
    // Whoever sent the message that names the document made it: the creator's move is the document's.
    showDocument({ docId: documentId, title, creator: mine ? 'self' : 'peer', seed: null });
  }, [showDocument, port]);

  const handleCreateDocument: (input: NewChatDocumentInput) => Promise<ChatDocumentMade> = useCallback(async ({ app, title, initialContent }: NewChatDocumentInput): Promise<ChatDocumentMade> => {
    // Was `if (!currentUserCid) return;` — a success-shaped no-op that closed
    // the modal and cleared the compose box having created nothing.
    if (currentUserCid === undefined) throw new Error('Cannot create a document before the session has a CID');
    if (port === null) throw new Error('This conversation has no live documents');
    // The picker offers only apps a chat can make; this refuses one a caller got around it with.
    if (!creatableIn(citadelApp(app), 'chat')) throw new Error(`${citadelApp(app).name} documents cannot be made in a chat yet.`);
    const checked: TitleCheck = validateDocTitle(title);
    if (!checked.ok) throw new Error(checked.reason);
    const docId: string = newChatDocumentId();
    // Opened once the invitation is in the conversation, not once the network has carried it.
    // Awaiting the whole send (CheckState, the leader's ack, the agent's transmit) left the
    // document closed behind "Creating...", and closed for good on a delivery failure although
    // it existed. A text message stops waiting at the same point (useP2PCompose).
    const invitation: Invitation = whenRecorded((onRecorded: () => void): Promise<unknown> =>
      port.invite({ docId, title: checked.title, onRecorded }));
    // No catch: a failure before the invitation exists is LiveDocumentModal's to render
    // ("Could not create the document…"); swallowing it here made that branch unreachable.
    await invitation.recorded;
    // The typed message becomes the document's first paragraphs, written by the canvas as it opens.
    showDocument({ docId, title: checked.title, creator: 'self', seed: initialContent.trim() === '' ? null : initialContent });
    return { delivered: invitation.delivered };
  }, [port, currentUserCid, showDocument]);

  const tabsWithUnread: (ChatTab & { hasUnread: boolean })[] = tabs.map(tab => ({
    ...tab,
    hasUnread: tab.id === 'messages' ? messagesHasUnread : tabActivity[tab.id] || false,
  }));

  return {
    activeTabId,
    activeTabIdRef,
    tabsWithUnread,
    activeTab: tabs.find(t => t.id === activeTabId),
    documents: documents.openings,
    setMessagesHasUnread,
    handleTabSelect,
    handleCloseTab,
    handleOpenDocument,
    handleCreateDocument,
    handleRenameDocument: documents.rename,
    renamable: (documentId: string): boolean => {
      const opening: ChatDocumentOpening | null | undefined = documents.openings.get(documentId);
      return opening?.kind === 'canvas' && opening.document.rename !== null;
    },
    retryDocument: documents.retry,
  };
}
