/**
 * Connection Service - Demo Simulation
 *
 * Demo/simulation methods for testing connection request flows.
 * These simulate backend functionality for demonstration purposes.
 */

import NotificationService, { NotificationType, NotificationPriority } from '@/lib/notification-service';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import type { ConnectionRequest, UserConnectionPreferences } from './types';
import { ConnectionType } from './types';

/**
 * Simulate receiving a connection request.
 * Creates a notification and optionally auto-accepts based on preferences.
 */
export function simulateRequestReceived(
  request: ConnectionRequest,
  notificationService: NotificationService,
  preferences: UserConnectionPreferences,
  acceptRequest: (requestId: string) => Promise<void>,
  rejectRequest: (requestId: string) => Promise<void>,
  onNewConnectionRequest: ((request: ConnectionRequest) => void) | null
): void {
  if (request.type === ConnectionType.P2P_REGISTRATION &&
    request.recipientId === 'current-user') {

    notificationService.addNotification({
      type: NotificationType.PEER_REGISTRATION,
      title: 'New Connection Request',
      content: request.message || `User ${request.requesterId} wants to connect with you`,
      senderId: request.requesterId,
      sourceId: request.id,
      priority: NotificationPriority.NORMAL,
      actionButtons: [
        { id: 'accept', label: 'Accept', variant: 'default', onClick: (): Promise<void> => acceptRequest(request.id) },
        { id: 'reject', label: 'Reject', variant: 'destructive', onClick: (): Promise<void> => rejectRequest(request.id) }
      ]
    });

    if (preferences.autoAcceptRegistrations) {
      setTimeout(() => {
        runAsyncSetup(async () => {
          await acceptRequest(request.id);
        });
      }, 1000);
    }

    onNewConnectionRequest?.(request);
  }
}

/**
 * Auto-accept P2P connection requests (these are always auto-accepted).
 */
export async function autoAcceptConnection(
  request: ConnectionRequest,
  notificationService: NotificationService,
  acceptRequest: (requestId: string) => Promise<void>
): Promise<void> {
  if (request.type === ConnectionType.P2P_CONNECTION) {
    notificationService.addSystemNotification(
      'Connection Established',
      `Your connection with user ${request.requesterId} has been automatically established.`,
      NotificationPriority.NORMAL,
      request.recipientId
    );
    await acceptRequest(request.id);
  }
}
