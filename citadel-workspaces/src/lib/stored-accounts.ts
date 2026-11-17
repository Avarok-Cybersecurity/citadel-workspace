/**
 * Asking the agent about the accounts it stores (`GetAccountInformation`, every
 * account), with a pure reader choosing what to take from the answer: the
 * workspace each is on (admission/account-servers.ts), the level each signs in
 * at (account-levels.ts).
 */
import { requestResponse } from '@/lib/websocket/request-response';
import { websocketService } from '@/lib/websocket-service';
import { TIMEOUT } from '@/lib/timeout-constants';
import { debugLog } from '@/lib/debug-config';
import { readAccountLevels } from './account-levels';

export type StoredAccountsReader<T> = (message: unknown, requestId: string) => T | null;

export function askStoredAccounts<T>(read: StoredAccountsReader<T>): Promise<T> {
  const requestId: string = crypto.randomUUID();
  return requestResponse<T>({
    request: { GetAccountInformation: { request_id: requestId, cid: null } },
    requestId,
    sendRequest: (request: unknown): Promise<void> => websocketService.sendMessage(request as Record<string, unknown>),
    timeoutMs: TIMEOUT.SERVER_REQUEST_MS,
    operationName: 'GetAccountInformation',
    matcher: {
      matchSuccess: (message: Record<string, unknown>): T | undefined => read(message, requestId) ?? undefined,
      matchFailure: (): string | undefined => undefined,
    },
  });
}

/** An agent that cannot be asked yields none, and the login form then disables no level. */
export async function browserAccountLevels(): Promise<ReadonlyMap<string, number>> {
  try {
    return await askStoredAccounts(readAccountLevels);
  } catch (error: unknown) {
    debugLog('Login', 'the agent could not say which level its accounts sign in at', error);
    return new Map<string, number>();
  }
}
