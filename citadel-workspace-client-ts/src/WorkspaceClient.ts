import { InternalServiceWasmClient } from 'citadel-internal-service-wasm-client';
import type { WasmClientConfig, InternalServiceRequest, InternalServiceResponse, WasmModule, SecurityLevel } from 'citadel-internal-service-wasm-client';
import { isResponseType } from 'citadel-internal-service-wasm-client';
import { isVariant } from 'citadel-internal-service-wasm-client';
import type { WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse } from './types/workspace-types';
import { WorkspaceAuth } from './auth';
import { WorkspaceSessionManager, type SessionConfig } from './session';

// Extends parent WasmModule with workspace-specific WASM methods
interface WorkspaceWasmModule extends WasmModule {
  open_messenger_for(cid_str: string): Promise<void>;
  ensure_messenger_open(cid_str: string): Promise<boolean>;
}

// MessageDelivered is not in InternalServiceResponse (type gap in auto-generated bindings).
// Defined here to avoid `as any` when accessing its fields.
interface MessageDeliveredPayload {
  contents: number[];
  cid?: bigint;
  peer_cid?: bigint;
}

// Enriched response types for workspace protocol messages.
// These extend InternalServiceResponse with parsed workspace payloads.
interface WorkspaceNotificationEnriched {
  WorkspaceNotification: {
    cid: bigint;
    peer_cid: bigint;
    message: number[];
    payload: WorkspaceProtocolPayload;
  };
}

interface WorkspaceDeliveredEnriched {
  WorkspaceDelivered: MessageDeliveredPayload & {
    payload: WorkspaceProtocolPayload;
  };
}

export type WorkspaceEnrichedResponse =
  | InternalServiceResponse
  | WorkspaceNotificationEnriched
  | WorkspaceDeliveredEnriched;

export interface WorkspaceClientConfig extends WasmClientConfig {
  // Additional workspace-specific configuration can be added here
  sessionConfig?: SessionConfig;
}

export class WorkspaceClient extends InternalServiceWasmClient {
  public readonly auth: WorkspaceAuth;
  public readonly session: WorkspaceSessionManager;

  constructor(config: WorkspaceClientConfig) {
    // Store reference to self for use in the handler closure below.
    // This is initialized after super() since `this` is unavailable before super().
    // The `if (self && self.session)` guards in the handler protect against the
    // window where super() hasn't completed yet.
    let self: WorkspaceClient;

    // Wrap the message handler to handle workspace protocol messages
    const originalHandler = config.messageHandler;

    config.messageHandler = (message: InternalServiceResponse) => {
      // Check if this is a MessageNotification that contains workspace protocol
      if (isResponseType(message, 'MessageNotification')) {
        const notification = message.MessageNotification;
        try {
          // Decode the message bytes as UTF-8 string
          const messageText = new TextDecoder().decode(new Uint8Array(notification.message));
          // Parse as WorkspaceProtocolPayload
          const workspacePayload: WorkspaceProtocolPayload = JSON.parse(messageText);

          // Handle workspace responses in session manager
          const payloadRecord = workspacePayload as Record<string, unknown>;
          if (self && self.session && isVariant(payloadRecord, 'Response')) {
            self.session.handleWorkspaceResponse(
              (workspacePayload as { Response: WorkspaceProtocolResponse }).Response
            );
          }

          // Create enriched message with parsed workspace payload
          const enrichedMessage: WorkspaceNotificationEnriched = {
            WorkspaceNotification: {
              ...notification,
              payload: workspacePayload
            }
          };

          // Call the original handler with the enriched message
          if (originalHandler) {
            originalHandler(enrichedMessage as unknown as InternalServiceResponse);
          }
        } catch (e) {
          // Not a workspace protocol message — pass through unchanged
          console.warn('[WorkspaceClient] Failed to parse MessageNotification as workspace protocol:', e);
          if (originalHandler) {
            originalHandler(message);
          }
        }
      } else if ('MessageDelivered' in message) {
        // MessageDelivered is not in InternalServiceResponse types (type gap) —
        // narrow via Record access to avoid `as any`
        const delivered = (message as Record<string, unknown>)['MessageDelivered'] as MessageDeliveredPayload | undefined;
        if (delivered && delivered.contents && Array.isArray(delivered.contents)) {
          try {
            // Decode the message bytes as UTF-8 string
            const messageText = new TextDecoder().decode(new Uint8Array(delivered.contents));
            // Parse as WorkspaceProtocolPayload
            const workspacePayload: WorkspaceProtocolPayload = JSON.parse(messageText);

            // Handle workspace responses in session manager
            const deliveredPayloadRecord = workspacePayload as Record<string, unknown>;
            if (self && self.session && isVariant(deliveredPayloadRecord, 'Response')) {
              self.session.handleWorkspaceResponse(
                (workspacePayload as { Response: WorkspaceProtocolResponse }).Response
              );
            }

            // Create enriched message with parsed workspace payload
            const enrichedMessage: WorkspaceDeliveredEnriched = {
              WorkspaceDelivered: {
                ...delivered,
                payload: workspacePayload
              }
            };

            // Call the original handler with the enriched message
            if (originalHandler) {
              originalHandler(enrichedMessage as unknown as InternalServiceResponse);
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
    securityLevel: SecurityLevel = 'Standard'
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
   * Override sendDirectToInternalService to automatically convert CID fields to BigInt.
   * This ensures all requests sent to WASM have proper BigInt CIDs.
   */
  override async sendDirectToInternalService(request: InternalServiceRequest): Promise<void> {
    const converted = this.convertCidsToBigInt(request);
    await super.sendDirectToInternalService(converted);
  }

  /**
   * Recursively converts cid, peer_cid, and session_cid fields to BigInt
   * for WASM compatibility (serde-wasm-bindgen expects BigInt for u64 fields).
   * Uses Record<string, unknown> internally for recursive traversal since
   * InternalServiceRequest is a discriminated union that can't be indexed generically.
   */
  private convertCidsToBigInt(obj: InternalServiceRequest): InternalServiceRequest {
    return this.convertCidsRecursive(obj) as InternalServiceRequest;
  }

  private convertCidsRecursive(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(item => this.convertCidsRecursive(item));

    const source = obj as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
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
        result[key] = this.convertCidsRecursive(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Get the WASM module instance with workspace-specific methods.
   * Parent's wasmModule is typed as WasmModule; this casts to WorkspaceWasmModule
   * which adds open_messenger_for and ensure_messenger_open.
   */
  private getWorkspaceWasmModule(): WorkspaceWasmModule {
    if (!this.wasmModule) {
      throw new Error('WASM module not initialized');
    }
    return this.wasmModule as unknown as WorkspaceWasmModule;
  }

  /**
   * Open a messenger handle for the given CID.
   * Creates an ISM (InterSession Messaging) channel for reliable-ordered messaging.
   * @param cid The CID to open the messenger for
   */
  async openMessengerFor(cid: string): Promise<void> {
    const wasmModule = this.getWorkspaceWasmModule();
    await wasmModule.open_messenger_for(cid);
  }

  /**
   * Ensures a messenger handle is open for the given CID.
   * Returns true if the messenger was just opened, false if already open.
   * Use this for polling to maintain messenger handles across leader/follower tab transitions.
   * @param cid The CID to ensure messenger is open for
   */
  async ensureMessengerOpen(cid: string): Promise<boolean> {
    const wasmModule = this.getWorkspaceWasmModule();
    return await wasmModule.ensure_messenger_open(cid);
  }

  /**
   * Send a P2P message to a peer using the WASM module directly
   * @param peerCid The CID of the peer to send to
   * @param message The message to send
   */
  async sendP2PMessageDirect(peerCid: string, message: string): Promise<void> {
    const wasmModule = this.getWorkspaceWasmModule();

    // Create InternalServiceRequest with Message variant
    const messageRequest: InternalServiceRequest = {
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
