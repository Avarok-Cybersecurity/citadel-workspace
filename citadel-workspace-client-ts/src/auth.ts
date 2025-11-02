import { WorkspaceClient } from './WorkspaceClient';
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
   * Get current session information
   */
  async getSession(): Promise<GetSessionsResponse | null> {
    if (!this.session) {
      return null;
    }

    try {
      // Send GetSession request
      await this.client.sendDirectToInternalService({
        GetSession: {
          cid: BigInt(this.session.cid),
          request_id: crypto.randomUUID()
        }
      } as any);

      // Wait for response
      const response = await this.client.nextMessage();
      
      if ('GetSessionResponse' in response) {
        return response.GetSessionResponse as GetSessionsResponse;
      }
      
      return null;
    } catch (error) {
      console.error('Failed to get session:', error);
      return null;
    }
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
      } as any);
      
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