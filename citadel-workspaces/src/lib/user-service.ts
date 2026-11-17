import NotificationService, { NotificationPriority } from './notification-service';
import { describeError } from '@/lib/describe-error';
import { websocketService } from './websocket-service';
import { getTabData, setTabData, removeTabData } from './tab-context';
import { connectionManager } from './connection';
import { debugLog } from '@/lib/debug-config';
import type { StoredSession } from '@/types/session-types';
import { requestResponse } from './websocket/request-response';
import { TIMEOUT } from './timeout-constants';
import { readAccountIdentity, type AccountIdentity } from './account-identity';

// Interface for user registration information
export interface UserRegistrationInfo {
  username: string;
  fullName: string;
  serverAddress: string;
  serverPassword?: string;
}

/**
 * UserService - provides access to user profile information
 * Now maintains per-tab user state for proper isolation
 */
export class UserService {
  private static instance: UserService;
  private notificationService: NotificationService;
  private static readonly TAB_USER_KEY: "current-user" = 'current-user';

  private constructor() {
    this.notificationService = NotificationService.getInstance();
  }

  /**
   * Get the singleton instance of the user service
   */
  public static getInstance(): UserService {
    if (!UserService.instance) {
      UserService.instance = new UserService();
    }
    return UserService.instance;
  }

  /**
   * Load the current user's registration information
   * @param serverAddress Server address to get registration info for
   * @param cid Connection ID for the user (important: always use CID for identification)
   */
  public async loadUserRegistration(serverAddress: string, cid: string): Promise<UserRegistrationInfo | null> {
    try {
      // First check if we have a tab-selected session that matches
      const selectedSession: StoredSession | null = await connectionManager.getTabSelectedSession();

      if (selectedSession && selectedSession.serverAddress === serverAddress) {
        // Use the selected session's user info
        const userInfo: UserRegistrationInfo = {
          username: selectedSession.username,
          fullName: selectedSession.fullName || selectedSession.username,
          serverAddress: selectedSession.serverAddress,
          serverPassword: undefined,
        };

        // Store in tab-specific storage
        await this.setCurrentUser(userInfo);

        return userInfo;
      }

      // If no matching selected session, try to get account info via request.
      //
      // `sendMessage`, not `getClient()`: a follower tab owns no client, so
      // this fallback threw there and the catch below raised a HIGH-priority
      // "User Profile Error" notification -- an alarming, permanent-looking
      // failure produced entirely by asking the wrong question. Nothing about
      // GetAccountInformation needs the raw client.
      // Asked AND answered: this used to send the request, set a "Loading..." placeholder
      // and rely on a response handler that did not exist, so the placeholder stayed.
      const requestId: string = crypto.randomUUID();
      const identity: AccountIdentity = await requestResponse<AccountIdentity>({
        request: { GetAccountInformation: { request_id: requestId, cid: BigInt(cid) } },
        requestId,
        sendRequest: (request: unknown): Promise<void> => websocketService.sendMessage(request as Record<string, unknown>),
        timeoutMs: TIMEOUT.SERVER_REQUEST_MS,
        operationName: 'GetAccountInformation',
        matcher: {
          matchSuccess: (message: Record<string, unknown>): AccountIdentity | undefined => readAccountIdentity(message, requestId, BigInt(cid)),
          matchFailure: (): string | undefined => undefined,
        },
      });
      const userInfo: UserRegistrationInfo = {
        username: identity.username,
        fullName: identity.fullName,
        serverAddress,
        serverPassword: undefined,
      };

      await this.setCurrentUser(userInfo);

      return userInfo;
    } catch (error) {
      debugLog('UserService', 'Error loading user registration:', error);
      this.notificationService.addSystemNotification(
        'User Profile Error',
        `Could not load user profile: ${describeError(error)}`,
        NotificationPriority.HIGH,
        cid // Associate with the session
      );
    }

    return null;
  }

  /**
   * Get the current user's registration information (tab-specific)
   */
  public async getCurrentUser(): Promise<UserRegistrationInfo | null> {
    return await getTabData<UserRegistrationInfo>(UserService.TAB_USER_KEY);
  }

  /**
   * Set the current user for this tab
   */
  private async setCurrentUser(user: UserRegistrationInfo): Promise<void> {
    await setTabData(UserService.TAB_USER_KEY, user);
  }

  /**
   * Clean up event listeners
   */
  public async cleanup(): Promise<void> {
    await removeTabData(UserService.TAB_USER_KEY);
  }
}

// Export singleton instance for convenience
export default UserService.getInstance();
