import { InternalServiceWasmClient } from 'citadel-internal-service-wasm-client';
import type { WasmClientConfig, InternalServiceRequest, InternalServiceResponse } from 'citadel-internal-service-wasm-client';
import type { WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse } from './types/workspace-types';
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
    // Store reference to self for use in handler
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
            originalHandler(modifiedMessage as any);
          }
        } catch (e) {
          // If it's not a workspace protocol message, pass it through unchanged
          if (originalHandler) {
            originalHandler(message);
          }
        }
      } else if ('MessageDelivered' in message) {
        // Also handle MessageDelivered which is used for workspace protocol responses
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
              originalHandler(modifiedMessage as any);
            }
          } catch (e) {
            // If it's not a workspace protocol message, pass it through unchanged
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
    securityLevel: string = 'Standard'
  ): Promise<void> {
    // Create the workspace protocol payload
    const payload: WorkspaceProtocolPayload = {
      Request: request
    };

    // Serialize to JSON bytes
    const messageBytes = new TextEncoder().encode(JSON.stringify(payload));

    // Convert cid to BigInt if it's a string
    const cidBigInt = typeof cid === 'string' ? BigInt(cid) : cid;

    // Create the internal service request
    const internalRequest: InternalServiceRequest = {
      Message: {
        request_id: crypto.randomUUID(),
        message: Array.from(messageBytes),
        cid: cidBigInt,
        peer_cid: null,
        security_level: securityLevel as any
      }
    };

    // Create a JSON-serializable version for the WASM client
    const jsonSerializableRequest = {
      Message: {
        request_id: internalRequest.Message.request_id,
        message: internalRequest.Message.message,
        cid: cidBigInt.toString(), // Convert BigInt to string for JSON serialization
        peer_cid: internalRequest.Message.peer_cid,
        security_level: internalRequest.Message.security_level
      }
    };

    // Send the JSON-serializable version directly using the underlying client method
    await this.sendDirectToInternalService(jsonSerializableRequest as any);
  }

  /**
   * Helper method to create a workspace
   */
  async createWorkspace(
    cid: string | bigint,
    name: string,
    description: string,
    workspaceMasterPassword: string,
    metadata?: number[]
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
  async getWorkspace(cid: string | bigint): Promise<void> {
    await this.sendWorkspaceRequest(cid, { GetWorkspace: null } as any);
  }

  /**
   * Helper method to list offices
   */
  async listOffices(cid: string | bigint): Promise<void> {
    await this.sendWorkspaceRequest(cid, { ListOffices: null } as any);
  }

  /**
   * Helper method to create an office
   */
  async createOffice(
    cid: string | bigint,
    workspaceId: string,
    name: string,
    description: string,
    mdxContent?: string,
    metadata?: number[]
  ): Promise<void> {
    await this.sendWorkspaceRequest(cid, {
      CreateOffice: {
        workspace_id: workspaceId,
        name,
        description,
        mdx_content: mdxContent,
        metadata
      }
    });
  }

  /**
   * Helper method to create a room
   */
  async createRoom(
    cid: string | bigint,
    officeId: string,
    name: string,
    description: string,
    mdxContent?: string,
    metadata?: number[]
  ): Promise<void> {
    await this.sendWorkspaceRequest(cid, {
      CreateRoom: {
        office_id: officeId,
        name,
        description,
        mdx_content: mdxContent,
        metadata
      }
    });
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
   * Get the WASM module instance from parent class
   */
  getWasmModule(): any {
    // Access the private wasmModule field from parent class
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