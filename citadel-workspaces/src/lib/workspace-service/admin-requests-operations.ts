/**
 * Asking the admins, and an admin's client taking its pending asks (`WorkspaceProtocolRequest::
 * AdminRequests`). Each request resolves with the server's answer of the kind it asked for.
 */
import type { AdminAskRefusal, AdminRequestEntry, AdminRequestsRequest, AdminRequestsResponse } from 'citadel-workspace-client-ts';
import { awaitWriteResponse } from './await-write-response';
import type { ProtocolSender } from './workspace-operations';

export type AskAnswer = { readonly kind: 'asked'; readonly admins: number } | { readonly kind: 'refused'; readonly refusal: AdminAskRefusal };

async function exchange<T>(sender: ProtocolSender, request: AdminRequestsRequest, read: (answer: AdminRequestsResponse) => T | null): Promise<T> {
  let answered: T | null = null;
  await awaitWriteResponse('AdminRequests', sender, { AdminRequests: request }, (payload: unknown): boolean => {
    // The payload is the AdminRequests variant's own value. Each reader takes only its own kind,
    // so the admins' "Waiting" nudge (a bare string, a push) never settles a request.
    answered = payload === null || payload === undefined ? null : read(payload as AdminRequestsResponse);
    return answered !== null;
  });
  if (answered === null) throw new Error('AdminRequests: the server\'s answer did not carry what was asked for');
  return answered;
}

export const askAdmins = (s: ProtocolSender, text: string): Promise<AskAnswer> =>
  exchange(s, { Ask: { text } }, (a: AdminRequestsResponse): AskAnswer | null => {
    if (typeof a !== 'object') return null;
    if ('Asked' in a) return { kind: 'asked', admins: a.Asked.admins };
    if ('Refused' in a) return { kind: 'refused', refusal: a.Refused };
    return null;
  });

export const takeAdminRequests = (s: ProtocolSender): Promise<AdminRequestEntry[]> =>
  exchange(s, 'Take', (a: AdminRequestsResponse): AdminRequestEntry[] | null => (typeof a === 'object' && 'Pending' in a ? a.Pending.entries : null));

export const ackAdminRequests = (s: ProtocolSender, ids: string[]): Promise<number> =>
  exchange(s, { Ack: { ids } }, (a: AdminRequestsResponse): number | null => (typeof a === 'object' && 'Acked' in a ? a.Acked.removed : null));
