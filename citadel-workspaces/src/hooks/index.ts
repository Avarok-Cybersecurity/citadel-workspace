/**
 * Hooks Module
 *
 * Centralized exports for all reusable React hooks.
 */

// Event listener hooks
export {
  useEventListener,
  useEventListeners,
  useEventCollector
} from './use-event-listener';

// Retry hook
export { useRetry } from './use-retry';

// Toast hook
export { useToast, toast } from './use-toast';

// Permission hooks
export { usePermission } from './use-permission';
export { useGroupPermissions } from './use-group-permissions';
export { useGroupRoles } from './use-group-roles';

// Group conversation hooks
export { useGroupConversations } from './use-group-conversations';

// P2P hooks
export { useRegisteredPeers } from './use-registered-peers';
export { useConversationPeers } from './use-conversation-peers';

// Mobile detection
export { useIsMobile } from './use-mobile';
