/**
 * Connection Service - Barrel Export
 *
 * Re-exports ALL public exports from the module for backward compatibility.
 * Consumers import from '@/lib/connection-service' (resolves to this file).
 */

// Types
export type {
  ConnectionRequest,
  UserConnection,
  UserConnectionPreferences,
  ConnectionStatus,
} from './types';

// Enums (must be value-exported, not type-exported)
export {
  ConnectionRequestStatus,
  ConnectionType,
} from './types';

// Main service class
export { ConnectionService } from './service';
