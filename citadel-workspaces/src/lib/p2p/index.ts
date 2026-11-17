/**
 * P2P Module
 *
 * Handles P2P messaging, presence, and persistence.
 */

// Types
export type {
  ConversationMetadata,
  MessagePage,
  P2PMessage,
  PeerPresence,
  P2PConversation,
  MessageCache,
} from './p2p-types';

export {
  MESSAGES_PER_PAGE,
  PAGINATED_PREFIX,
} from './p2p-types';

// Storage
export { MessagePaginationStore, messagePaginationStore } from './message-pagination-store';
export { startRetentionSweeper } from './retention-sweep';

// Conversation
export { ConversationManager } from './conversation-manager';
export type { ConversationManagerConfig } from './conversation-manager';

// Presence
export { PresenceManager } from './presence-manager';
export type { PresenceListener, TypingListener, PresenceManagerConfig } from './presence-manager';

// CheckState
export { CheckStateManager } from './checkstate-manager';
export type { CheckStateConfig } from './checkstate-manager';

// Message Handler
export { MessageHandler } from './message-handler';
export type { MessageHandlerConfig } from './message-handler';

// Message Sender
export { MessageSender } from './message-sender';
export type { MessageSenderConfig } from './message-sender';

// Message Ack Handler
export { MessageAckHandler } from './message-ack-handler';
export type { MessageAckHandlerConfig } from './message-ack-handler';

// File Transfer Message Handler
export { FileTransferMessageHandler } from './file-transfer-message-handler';
export type { FileTransferMessageHandlerConfig } from './file-transfer-message-handler';

// Main Manager (to be updated). `getP2PMessengerManager` is the
// internal lazy initialiser — kept private to `p2p-messenger-manager.ts`
// because the Proxy `p2pMessengerManager` already serves every
// external consumer and re-exporting the getter would just add public
// API surface area with no caller.
export { P2PMessengerManager, p2pMessengerManager } from './p2p-messenger-manager';
