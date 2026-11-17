/**
 * The workspace's sign-in settings on the kernel: `GetSignInSettings` (any member) and
 * `UpdateSignInSettings` (admins only), each answered with `SignInSettings` as the server holds
 * it -- after an update, read back from where the server's admission check reads it.
 */
import type { SignInSettings } from 'citadel-workspace-client-ts';
import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';
import { awaitWriteResponse } from './await-write-response';
import type { ProtocolSender } from './workspace-operations';

/** The settings an answer carries, or null for anything else. */
export function parseSignInSettings(payload: unknown): SignInSettings | null {
  if (!payload || typeof payload !== 'object') return null;
  const required: unknown = (payload as Record<string, unknown>).require_turnstile_sign_in;
  return typeof required === 'boolean' ? { require_turnstile_sign_in: required } : null;
}

/** Sends `request` and resolves with the settings the server answers it with. */
async function exchange(sender: ProtocolSender, requestType: 'GetSignInSettings' | 'UpdateSignInSettings', request: WorkspaceProtocolRequestTS): Promise<SignInSettings> {
  let answered: SignInSettings | null = null;
  await awaitWriteResponse(requestType, () => sender.sendProtocolRequest(request), (payload: unknown): boolean => {
    answered = parseSignInSettings(payload);
    return answered !== null;
  });
  if (answered === null) throw new Error(`${requestType}: the server's answer carried no settings`);
  return answered;
}

export function getSignInSettings(sender: ProtocolSender): Promise<SignInSettings> {
  return exchange(sender, 'GetSignInSettings', { GetSignInSettings: null });
}

export function updateSignInSettings(sender: ProtocolSender, settings: SignInSettings): Promise<SignInSettings> {
  return exchange(sender, 'UpdateSignInSettings', { UpdateSignInSettings: { settings } });
}
