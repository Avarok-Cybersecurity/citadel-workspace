import { InternalServiceWasmClient } from 'citadel-internal-service-wasm-client';
import type { WasmClientConfig, InternalServiceRequest, InternalServiceResponse } from 'citadel-internal-service-wasm-client';
import type { WorkspaceProtocolPayload, WorkspaceProtocolRequest } from './types/workspace-types';
import { WorkspaceAuth } from './auth';
import { WorkspaceSessionManager, type SessionConfig } from './session';

export interface WorkspaceClientConfig extends WasmClientConfig {
  // Additional workspace-specific configuration can be added here
  sessionConfig?: SessionConfig;
}

export class WorkspaceClient extends InternalServiceWasmClient {
  public readonly auth: WorkspaceAuth;
  public readonly session: WorkspaceSessionManager;
  
  constructor(config: WorkspaceClientConfig) {
    // Store reference to self for use in the handler closure below.
    // This is initialized after super() (line 114) since `this` is unavailable before super().
    // The `if (self && self.session)` guards in the handler protect against the
    // window where super() hasn't completed yet.
    let self: WorkspaceClient;
    
    // Wrap the message handler to handle workspace protocol messages
    const originalHandler = config.messageHandler;
    
    config.messageHandler = (message: InternalServiceResponse) => {
      // Check if this is a MessageNotification that contains workspace protocol
      if ('MessageNotification' in message) {
        const notification = message.MessageNotification;
        try {
          // Decode the message bytes as UTF-8 string
          const messageText = new TextDecoder().decode(new Uint8Array(notification.message));
          // Parse as WorkspaceProtocolPayload
          const workspacePayload: WorkspaceProtocolPayload = JSON.parse(messageText);
          
          // Handle workspace responses in session manager
          if (self && self.session && 'Response' in workspacePayload) {
            self.session.handleWorkspaceResponse(workspacePayload.Response);
          }
          
          // Create a modified message with the parsed payload
          const modifiedMessage = {
            ...message,
            WorkspaceNotification: {
              ...notification,
              payload: workspacePayload
            }
          };
          
          // Call the original handler with the modified message
          if (originalHandler) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- enriched message extends InternalServiceResponse with workspace fields
            originalHandler(modifiedMessage as any);
          }
        } catch (e) {
          // Not a workspace protocol message — pass through unchanged
          console.warn('[WorkspaceClient] Failed to parse MessageNotification as workspace protocol:', e);
          if (originalHandler) {
            originalHandler(message);
          }
        }
      } else if ('MessageDelivered' in message) {
        // Also handle MessageDelivered which is used for workspace protocol responses
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MessageDelivered shape not in InternalServiceResponse types
        const delivered = message.MessageDelivered as any;
        if (delivered && delivered.contents && Array.isArray(delivered.contents)) {
          try {
            // Decode the message bytes as UTF-8 string
            const messageText = new TextDecoder().decode(new Uint8Array(delivered.contents));
            // Parse as WorkspaceProtocolPayload
            const workspacePayload: WorkspaceProtocolPayload = JSON.parse(messageText);
            
            // Handle workspace responses in session manager
            if (self && self.session && 'Response' in workspacePayload) {
              self.session.handleWorkspaceResponse(workspacePayload.Response);
            }
            
            // Create a modified message with the parsed payload
            const modifiedMessage = {
              ...message,
              WorkspaceDelivered: {
                ...delivered,
                payload: workspacePayload
              }
            };
            
            // Call the original handler with the modified message
            if (originalHandler) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- enriched message extends InternalServiceResponse with workspace fields
              originalHandler(modifiedMessage as any);
            }
          } catch (e) {
            // Not a workspace protocol message — pass through unchanged
            console.warn('[WorkspaceClient] Failed to parse MessageDelivered as workspace protocol:', e);
            if (originalHandler) {
              originalHandler(message);
            }
          }
        } else {
          // Pass through if no contents
          if (originalHandler) {
            originalHandler(message);
          }
        }
      } else {
        // Pass through other messages unchanged
        if (originalHandler) {
          originalHandler(message);
        }
      }
    };
    
    super(config);
    
    // Initialize auth module
    this.auth = new WorkspaceAuth(this);
    
    // Initialize session manager
    this.session = new WorkspaceSessionManager(this, config.sessionConfig);
    
    // Set self reference for use in message handler
    self = this;
  }

  /**
   * Send a workspace protocol request
   * @param cid The client ID
   * @param request The workspace protocol request
   * @param securityLevel The security level (default: 'Standard')
   */
  async sendWorkspaceRequest(
    cid: string | bigint,
    request: WorkspaceProtocolRequest,
    securityLevel: 'Standard' | 'High' | 'Maximum' = 'Standard'
  ): Promise<void> {
    // Create the workspace protocol payload
    const payload: WorkspaceProtocolPayload = {
      Request: request
    };

    // Serialize to JSON bytes
    const messageBytes = new TextEncoder().encode(JSON.stringify(payload));

    // Convert cid to BigInt if it's a string
    const cidBigInt = typeof cid === 'string' ? BigInt(cid) : cid;

    // Create the internal service request with BigInt CID
    // serde-wasm-bindgen handles BigInt natively for u64 fields
    const internalRequest: InternalServiceRequest = {
      Message: {
        request_id: crypto.randomUUID(),
        message: Array.from(messageBytes),
        cid: cidBigInt,
        peer_cid: null,
        security_level: securityLevel
      }
    };

    // Send directly - serde-wasm-bindgen handles BigInt natively
    await this.sendDirectToInternalService(internalRequest);
  }

  /**
   * Helper method to create a workspace
   */
  async createWorkspace(
    cid: string | bigint,
    name: string,
    description: string,
    workspaceMasterPassword: string,
    metadata: number[] | null = null
  ): Promise<void> {
    await this.sendWorkspaceRequest(cid, {
      CreateWorkspace: {
        name,
        description,
        workspace_master_password: workspaceMasterPassword,
        metadata
      }
    });
  }

  /**
   * Helper method to get the workspace
   */
  async getWorkspace(cid: string | bigint, workspaceId?: string): Promise<void> {
    await this.sendWorkspaceRequest(cid, {
      GetWorkspace: { workspace_id: workspaceId ?? null }
    });
  }

  /**
   * Helper method to list all workspaces the user has access to
   */
  async listWorkspaces(cid: string | bigint): Promise<void> {
    await this.sendWorkspaceRequest(cid, 'ListWorkspaces');
  }

  /**
   * Helper method to send a message
   */
  async sendMessage(cid: string | bigint, contents: Uint8Array): Promise<void> {
    await this.sendWorkspaceRequest(cid, {
      Message: {
        contents: Array.from(contents)
      }
    });
  }

  /**
   * Override sendDirectToInternalService to automatically convert CID fields to BigInt
   * This ensures all requests sent to WASM have proper BigInt CIDs
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts both InternalServiceRequest and untyped WASM requests
  override async sendDirectToInternalService(request: any): Promise<void> {
    const converted = this.convertCidsToBigInt(request);
    await super.sendDirectToInternalService(converted);
  }

  /**
   * Recursively converts cid, peer_cid, and session_cid fields to BigInt
   * for WASM compatibility (serde-wasm-bindgen expects BigInt for u64 fields)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recursive object transform operates on unknown shapes
  private convertCidsToBigInt(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(item => this.convertCidsToBigInt(item));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- building result of unknown shape
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if ((key === 'cid' || key === 'peer_cid' || key === 'session_cid') && value !== null && value !== undefined) {
        // Convert string/number CID to BigInt with validation
        if (typeof value === 'bigint') {
          result[key] = value;
        } else {
          try {
            result[key] = BigInt(value as string | number);
          } catch {
            throw new Error(`Invalid CID value for ${key}: ${String(value)}`);
          }
        }
      } else if (typeof value === 'object') {
        result[key] = this.convertCidsToBigInt(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Get the WASM module instance from parent class
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- WASM module lacks TypeScript type definitions
  getWasmModule(): any {
    // Access the private wasmModule field from parent class
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing private parent field
    return (this as any).wasmModule;
  }

  /**
   * Open a messenger handle for the given CID.
   * Creates an ISM (InterSession Messaging) channel for reliable-ordered messaging.
   * @param cid The CID to open the messenger for
   */
  async openMessengerFor(cid: string): Promise<void> {
    const wasmModule = this.getWasmModule();
    if (!wasmModule) {
      throw new Error('WASM module not initialized');
    }

    await wasmModule.open_messenger_for(cid);
  }

  /**
   * Ensures a messenger handle is open for the given CID.
   * Returns true if the messenger was just opened, false if already open.
   * Use this for polling to maintain messenger handles across leader/follower tab transitions.
   * @param cid The CID to ensure messenger is open for
   */
  async ensureMessengerOpen(cid: string): Promise<boolean> {
    const wasmModule = this.getWasmModule();
    if (!wasmModule) {
      throw new Error('WASM module not initialized');
    }

    return await wasmModule.ensure_messenger_open(cid);
  }

  /**
   * Send a P2P message to a peer using the WASM module directly
   * @param peerCid The CID of the peer to send to
   * @param message The message to send
   */
  async sendP2PMessageDirect(peerCid: string, message: string): Promise<void> {
    const wasmModule = this.getWasmModule();
    if (!wasmModule) {
      throw new Error('WASM module not initialized');
    }
    
    // Create InternalServiceRequest with Message variant
    const messageRequest = {
      Message: {
        request_id: crypto.randomUUID(),
        message: Array.from(new TextEncoder().encode(message)),
        cid: BigInt(this.getCurrentCid() || '0'), // sender CID
        peer_cid: BigInt(peerCid), // recipient CID
        security_level: 'Standard'
      }
    };
    
    // Send the P2P message through WASM
    await wasmModule.send_p2p_message(peerCid, messageRequest);
  }
}