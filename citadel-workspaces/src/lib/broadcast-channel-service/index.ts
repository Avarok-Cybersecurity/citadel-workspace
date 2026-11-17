/**
 * Broadcast Channel Service - Barrel Export
 *
 * Re-exports ALL public exports from the module for backward compatibility.
 * Consumers import from '@/lib/broadcast-channel-service' (resolves to this file).
 */

// Types
export type { BroadcastMessage } from './types';

// Main service class & singleton
export { BroadcastChannelService } from './service';

import { BroadcastChannelService } from './service';
export const broadcastChannelService: BroadcastChannelService = BroadcastChannelService.getInstance();
