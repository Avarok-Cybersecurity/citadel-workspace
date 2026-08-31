import { WorkspaceClient } from './WorkspaceClient';
import { isResponseType } from 'citadel-internal-service-wasm-client';
import type { WasmConnectOptions as ConnectOptions, WasmRegisterOptions as RegisterOptions } from 'citadel-internal-service-wasm-client';
import type { ConnectSuccess, RegisterSuccess, GetSessionsResponse } from 'citadel-internal-service-wasm-client';

export interface AuthSession {
  cid: string;
  workspaceId?: string;
  connectedAt: Date;
  isAuthenticated: boolean;
}

export class WorkspaceAuth {
  private client: WorkspaceClient;
  private session: AuthSession | null = null;
  private sessionListeners: Set<(session: AuthSession | null) => void> = new Set();

  constructor(client: WorkspaceClient) {
    this.client = client;
  }

  /**
   * Connect to the server (without registration)
   */
  async connect(options: ConnectOptions): Promise<ConnectSuccess> {
    const result = await this.client.connect(options);
    
    // Update session
    this.session = {
      cid: result.cid.toString(),
      connectedAt: new Date(),
      isAuthenticated: false
    };
    
    this.notifySessionListeners();
    return result;
  }

  /**
   * Register with the server (creates a new account)
   */
  async register(options: RegisterOptions): Promise<RegisterSuccess> {
    const result = await this.client.register(options);
    
    // Update session
    this.session = {
      cid: result.cid.toString(),
      connectedAt: new Date(),
      isAuthenticated: true
    };
    
    this.notifySessionListeners();
    return result;
  }

  /**
   * Get current session information from the internal service.
   *
   * Returns null ONLY when there is no local session to query. Transport
   * errors and timeouts now throw — they used to be swallowed into the same
   * null, making "no session" indistinguishable from "the query failed".
   *
   * Correlation runs through client.nextResponse(), matched on the request_id
   * the internal service echoes back (get_sessions.rs sets
   * `request_id: Some(request_id)`). The previous implementation called
   * client.nextMessage(), which contends for the WASM stream with the
   * client's own processing loop: the WASM guard throws "next_message is
   * already being called by another process" on reentrancy, so this method
   * could never succeed — or, on winning the race, stole an arbitrary
   * message from the loop.
   *
   * @param timeoutMs How long to wait for the response. The default matches
   *                  the base client's waitForResponse timeout so both
   *                  correlation paths behave alike.
   */
  async getSession(timeoutMs: number = 30000): Promise<GetSessionsResponse | null> {
    if (!this.session) {
      return null;
    }

    const requestId = crypto.randomUUID();

    // Register the waiter BEFORE sending, so the response cannot arrive in
    // the gap between send and listen.
    const pending = this.client.nextResponse(
      (message) =>
        isResponseType(message, 'GetSessionsResponse') &&
        message.GetSessionsResponse.request_id === requestId
          ? message.GetSessionsResponse
          : undefined,
      timeoutMs
    );

    try {
      // Send GetSessions request (note: plural — GetSession singular does not exist in InternalServiceRequest)
      await this.client.sendDirectToInternalService({
        GetSessions: {
          request_id: requestId
        }
      });
    } catch (error) {
      // The request never left; the waiter's eventual timeout rejection is
      // expected noise, not a separate failure to surface.
      void pending.catch(() => undefined);
      throw error;
    }

    return await pending;
  }

  /**
   * Disconnect from the server
   */
  async disconnect(): Promise<void> {
    if (!this.session) {
      return;
    }

    try {
      await this.client.sendDirectToInternalService({
        Disconnect: {
          cid: BigInt(this.session.cid),
          request_id: crypto.randomUUID()
        }
      });

      await this.client.close();
    } catch (error) {
      console.error('Error during disconnect:', error);
    } finally {
      this.session = null;
      this.notifySessionListeners();
    }
  }

  /**
   * Check if currently authenticated
   */
  isAuthenticated(): boolean {
    return this.session?.isAuthenticated ?? false;
  }

  /**
   * Get current CID
   */
  getCurrentCid(): string | null {
    return this.session?.cid ?? null;
  }

  /**
   * Get current session
   */
  getCurrentSession(): AuthSession | null {
    return this.session;
  }

  /**
   * Add session change listener
   */
  onSessionChange(listener: (session: AuthSession | null) => void): () => void {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  private notifySessionListeners(): void {
    this.sessionListeners.forEach(listener => {
      listener(this.session);
    });
  }

  /**
   * Set the current workspace ID in the session
   */
  setWorkspaceId(workspaceId: string): void {
    if (this.session) {
      this.session.workspaceId = workspaceId;
      this.notifySessionListeners();
    }
  }

  /**
   * Clear the current workspace ID from the session
   */
  clearWorkspaceId(): void {
    if (this.session) {
      delete this.session.workspaceId;
      this.notifySessionListeners();
    }
  }
}