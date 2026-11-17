/**
 * Broadcast Channel Service - Types
 *
 * Interfaces, type guards, and constants for cross-tab communication.
 */

import { INTERVAL } from '@/lib/timeout-constants';

export interface BroadcastMessage {
  type: 'workspace-response' | 'state-sync' | 'connection-status' | 'register-request' | 'p2p-notification';
  data: unknown;
  timestamp: number;
  tabId: string;
  isLeader?: boolean;
  /** Target CID for P2P notifications - used to filter broadcasts by session */
  targetCid?: bigint;
}

export interface PendingRequest {
  cid: bigint;
  insertTime: number;
}

export interface LeaderElectionMessage {
  tabId: string;
  timestamp: number;
  priority: number;
}

export const CHANNEL_NAME: "citadel-workspace-sync" = 'citadel-workspace-sync';
export const REQUEST_EXPIRY_MS: number = 30 * 60 * 1000;
export const CLEANUP_INTERVAL_MS: number = INTERVAL.CLEANUP_MS;
