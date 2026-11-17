/**
 * After a reload, a pending request card read "hana87108.lab wants to connect"
 * (live 09-26): it was rebuilt before the roster's names had loaded, and the
 * name it had first ("Hana High") never came back. The card now follows the
 * roster: when names are recorded, pending request cards take them.
 */
import { describe, it, expect } from 'vitest';
import { notificationService } from '../service';
import { NotificationType } from '../types';
import { recordMemberNames } from '@/lib/member-names';
import type { Notification } from '../types';

describe('a pending connection-request card', () => {
  it("takes the requester's name once the roster knows it", () => {
    const added: Notification = notificationService.addPeerRegistrationNotification(
      'late.name.user', '5391274032', 'req-late', (): void => {}, (): void => {}, (): void => {},
    );
    expect(added.title).toBe('late.name.user wants to connect');

    recordMemberNames([{ id: 'late.name.user', displayName: 'Late Name' }]);

    const now: Notification | undefined = notificationService.getNotificationsByType(NotificationType.PEER_REGISTRATION).find((n: Notification) => n.id === added.id);
    expect(now?.title).toBe('Late Name wants to connect');
    expect(now?.senderName).toBe('Late Name');
  });
});
