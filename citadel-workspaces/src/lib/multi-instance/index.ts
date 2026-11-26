/**
 * Multi-Instance Module
 *
 * Coordinates multiple browser tabs/windows running the Citadel workspace.
 * Each tab is an "instance" with its own identity but shares a WebSocket
 * connection via leader election.
 *
 * Architecture:
 * - instanceManager: Tracks this tab's identity and session (CID)
 * - instanceChannel: Inter-tab communication via BroadcastChannel
 * - instanceInboundRouter: Routes WebSocket messages to correct tab (leader only)
 * - leaderOutboundHandler: Processes all outgoing messages (leader only)
 * - outboundQueue: Tracks pending messages and retries
 */

// Core instance tracking
export { instanceManager, InstanceManager } from './instance-manager';
export type { InstanceState, InstanceInfo } from './instance-manager';

// Inter-instance communication
export { instanceChannel, InstanceChannel } from './instance-channel';
export type { ChannelMessage, ChannelMessageType } from './instance-channel';

// Inbound message routing (leader)
export { instanceInboundRouter, InstanceInboundRouter } from './instance-inbound-router';

// Outbound message handling (leader)
export { leaderOutboundHandler, LeaderOutboundHandler } from './leader-outbound-handler';

// Message queue and retry
export { outboundQueue, OutboundQueue } from './outbound-queue';
export type { QueuedMessage, AckResult } from './outbound-queue';

import { instanceChannel } from './instance-channel';
import { instanceInboundRouter } from './instance-inbound-router';

/** Starts this tab's part in multi-tab coordination. Boot calls it; importing the module schedules nothing. */
export function startInstanceCoordination(): void {
  instanceChannel.start();
  instanceInboundRouter.start();
}

/** Ends this tab's part: says goodbye, closes the channel and stops every timer start began. Final. */
export function stopInstanceCoordination(): void {
  instanceChannel.destroy();
  instanceInboundRouter.stop();
}
