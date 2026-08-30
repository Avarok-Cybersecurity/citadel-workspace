import { WorkspaceClient } from './WorkspaceClient';
import { WorkspaceAuth } from './auth';
import { isVariant } from 'citadel-internal-service-wasm-client';
import type { WorkspaceProtocolResponse } from './types/workspace-types';

export interface SessionConfig {
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export interface WorkspaceSessionInfo {
  workspaceId: string;
  workspaceName?: string;
  role?: string;
  joinedAt: Date;
}

export class WorkspaceSessionManager {
  private client: WorkspaceClient;
  private auth: WorkspaceAuth;
  private config: Required<SessionConfig>;
  private workspaceSession: WorkspaceSessionInfo | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private removeErrorListener?: () => void;
  private sessionListeners: Set<(session: WorkspaceSessionInfo | null) => void> = new Set();

  constructor(client: WorkspaceClient, config: SessionConfig = {}) {
    this.client = client;
    this.auth = client.auth;
    this.config = {
      autoReconnect: true,
      reconnectInterval: 5000,
      maxReconnectAttempts: 5,
      ...config
    };

    // Listen for disconnections
    this.setupErrorHandling();
  }

  /**
   * Load a workspace (get workspace details)
   */
  async loadWorkspace(): Promise<void> {
    const cid = this.auth.getCurrentCid();
    if (!cid) {
      throw new Error('Not connected. Please connect or register first.');
    }

    // Send get workspace request
    await this.client.getWorkspace(cid);
  }

  /**
   * Set the current workspace session
   */
  setWorkspaceSession(workspaceId: string, workspaceName?: string): void {
    this.workspaceSession = {
      workspaceId,
      workspaceName,
      joinedAt: new Date()
    };

    // Update auth session
    this.auth.setWorkspaceId(workspaceId);
    
    this.notifySessionListeners();
  }

  /**
   * Clear the current workspace session
   */
  clearWorkspaceSession(): void {
    // Clear session
    this.workspaceSession = null;
    this.auth.clearWorkspaceId();
    
    this.notifySessionListeners();
  }

  /**
   * Get current workspace session
   */
  getCurrentWorkspaceSession(): WorkspaceSessionInfo | null {
    return this.workspaceSession;
  }

  /**
   * Check if currently in a workspace
   */
  isInWorkspace(): boolean {
    return this.workspaceSession !== null;
  }

  /**
   * Add workspace session change listener
   */
  onWorkspaceSessionChange(listener: (session: WorkspaceSessionInfo | null) => void): () => void {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  private notifySessionListeners(): void {
    this.sessionListeners.forEach(listener => {
      listener(this.workspaceSession);
    });
  }

  private setupErrorHandling(): void {
    // ADDS a listener rather than replacing the single handler slot. This used
    // to call `setErrorHandler`, which overwrites it — so every caller that
    // passed `errorHandler` in the config had it silently discarded in this
    // constructor, before their first error. The running app passes one.
    this.removeErrorListener = this.client.addErrorListener((error: Error) => {
      console.error('Connection error:', error);

      if (this.config.autoReconnect && this.reconnectAttempts < this.config.maxReconnectAttempts) {
        this.scheduleReconnect();
      }
    });

    // Listen for auth session changes
    this.auth.onSessionChange((session) => {
      if (!session && this.workspaceSession) {
        // Connection lost while in workspace
        this.workspaceSession = null;
        this.notifySessionListeners();
      }
    });
  }

  /**
   * Release this manager's subscriptions and cancel any pending reconnect.
   *
   * Without it a discarded manager could still fire a timer that touched auth
   * state, and its error listener and session subscription lived forever.
   */
  dispose(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.removeErrorListener?.();
    this.removeErrorListener = undefined;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectAttempts++;
    console.log(`Scheduling reconnect attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts}`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;

      // This used to log "Reconnection would require stored credentials" and
      // then CLEAR the workspace session — on the success path, unconditionally.
      // Combined with the handler clobber above, any error from the WASM layer,
      // including a routine message-processing error, threw the user out of
      // their workspace. It never attempted a reconnection of any kind, while
      // the base client has had a real one all along.
      //
      // The session is deliberately NOT cleared on failure either. A CID is
      // permanent per account and the session survives a transport drop, so
      // discarding local session state is both wrong and unrecoverable — the
      // caller decides what a dead transport means to them.
      try {
        await this.client.restart_ws_connection();
        this.reconnectAttempts = 0;
      } catch (error) {
        console.error('Reconnect failed:', error);

        if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      }
    }, this.config.reconnectInterval);
  }

  /**
   * Handle workspace protocol responses
   */
  handleWorkspaceResponse(response: WorkspaceProtocolResponse): void {
    // Guard against string variants (e.g. "WorkspaceNotInitialized") before using `in`
    if (typeof response !== 'object' || response === null) {
      return;
    }

    if (isVariant(response, 'Workspace')) {
      const workspace = response.Workspace;
      // Update session with workspace info
      if (!this.workspaceSession || this.workspaceSession.workspaceId !== workspace.id) {
        this.setWorkspaceSession(workspace.id, workspace.name);
      } else {
        this.workspaceSession.workspaceName = workspace.name;
        this.notifySessionListeners();
      }
    } else if (isVariant(response, 'Error')) {
      const error = response.Error;
      console.error('Workspace error:', error);
      
      // Clear session on certain errors
      if (error.includes('Not in workspace') || 
          error.includes('Workspace not found')) {
        this.workspaceSession = null;
        this.auth.clearWorkspaceId();
        this.notifySessionListeners();
      }
    }
  }
}