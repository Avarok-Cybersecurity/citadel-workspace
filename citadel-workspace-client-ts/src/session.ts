import { WorkspaceClient } from './WorkspaceClient';
import { WorkspaceAuth } from './auth';
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
  private config: SessionConfig;
  private workspaceSession: WorkspaceSessionInfo | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
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
    // Listen for connection errors
    this.client.setErrorHandler((error: Error) => {
      console.error('Connection error:', error);
      
      if (this.config.autoReconnect && this.reconnectAttempts < this.config.maxReconnectAttempts!) {
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

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectAttempts++;
    console.log(`Scheduling reconnect attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts}`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      
      try {
        // Try to reconnect - would need stored credentials
        // For now, just log that reconnection would require credentials
        console.log('Reconnection would require stored credentials');
        
        // Clear workspace session on disconnect
        if (this.workspaceSession) {
          this.clearWorkspaceSession();
        }
      } catch (error) {
        console.error('Reconnect failed:', error);
        
        if (this.reconnectAttempts < this.config.maxReconnectAttempts!) {
          this.scheduleReconnect();
        }
      }
    }, this.config.reconnectInterval);
  }

  /**
   * Handle workspace protocol responses
   */
  handleWorkspaceResponse(response: WorkspaceProtocolResponse): void {
    if ('Workspace' in response) {
      const workspace = response.Workspace;
      // Update session with workspace info
      if (!this.workspaceSession || this.workspaceSession.workspaceId !== workspace.id) {
        this.setWorkspaceSession(workspace.id, workspace.name);
      } else {
        this.workspaceSession.workspaceName = workspace.name;
        this.notifySessionListeners();
      }
    } else if ('Error' in response) {
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