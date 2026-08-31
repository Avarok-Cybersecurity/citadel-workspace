import { InternalServiceWasmClient } from 'citadel-internal-service-wasm-client';
import type { WasmClientConfig, InternalServiceRequest, InternalServiceResponse, WasmModule, SecurityLevel } from 'citadel-internal-service-wasm-client';
import { isResponseType } from 'citadel-internal-service-wasm-client';
import { isVariant } from 'citadel-internal-service-wasm-client';
import type { WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse } from './types/workspace-types';
import { decodeWorkspacePayload, encodeWorkspacePayload } from './workspace-json';
import { WorkspaceAuth } from './auth';
import { WorkspaceSessionManager, type SessionConfig } from './session';

// Extends parent WasmModule with workspace-specific WASM methods
interface WorkspaceWasmModule extends WasmModule {
  open_messenger_for(cid_str: string): Promise<void>;
  ensure_messenger_open(cid_str: string): Promise<boolean>;
  send_media_frame(
    local_cid_str: string,
    peer_cid_str: string,
    track: number,
    kind: number,
    timestamp: number,
    flags: number,
    payload: Uint8Array,
  ): void;
}

// Enriched response types for workspace protocol messages.
// These extend InternalServiceResponse with parsed workspace payloads.
//
// A `WorkspaceDelivered` / `MessageDelivered` pair used to live here too, with
// a comment claiming MessageDelivered "exists at runtime but not in the
// generated types". It does not exist at all: no Rust crate in this tree
// (citadel-internal-service, citadel-workspace-server-kernel,
// citadel-workspace-types) produces a MessageDelivered response, so the branch
// that parsed it was dead code — and, unlike its MessageNotification sibling,
// it JSON-parsed peer-controllable bytes with no fromServer/JSON guard. Both
// the types and the branch were removed rather than guarded.
interface WorkspaceNotificationEnriched {
  WorkspaceNotification: {
    cid: bigint;
    peer_cid: bigint;
    message: number[];
    payload: WorkspaceProtocolPayload;
  };
}

export type WorkspaceEnrichedResponse =
  | InternalServiceResponse
  | WorkspaceNotificationEnriched;

export interface WorkspaceClientConfig extends WasmClientConfig {
  // Additional workspace-specific configuration can be added here
  sessionConfig?: SessionConfig;
}

/**
 * Whether a MessageNotification payload is workspace-protocol JSON.
 *
 * Workspace protocol is JSON and always serialises to an object, so the first
 * non-whitespace byte is '{' (0x7b). P2P chat is CBOR, whose first byte is a
 * major-type tag — 0xa0-0xbf for the maps it produces — and never 0x7b. One
 * byte therefore separates the two without decoding the payload or throwing.
 *
 * Deliberately conservative: anything that looks like JSON is still handed to
 * the real parser, so a malformed workspace message still surfaces as a
 * warning rather than being silently reclassified as chat.
 */
function looksLikeWorkspaceJson(payload: number[] | Uint8Array): boolean {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  for (const byte of bytes) {
    // Skip leading ASCII whitespace: space, tab, LF, CR.
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
    return byte === 0x7b;
  }
  return false;
}

export class WorkspaceClient extends InternalServiceWasmClient {
  public readonly auth: WorkspaceAuth;
  public readonly session: WorkspaceSessionManager;

  /**
   * One-shot observers registered by nextResponse(). Notified with every raw
   * InternalServiceResponse before enrichment; they observe, never consume.
   */
  private responseObservers: Set<(message: InternalServiceResponse) => void> = new Set();

  constructor(config: WorkspaceClientConfig) {
    // Store reference to self for use in the handler closure below.
    // This is initialized after super() since `this` is unavailable before super().
    // The `if (self && self.session)` guards in the handler protect against the
    // window where super() hasn't completed yet.
    let self: WorkspaceClient;

    // Wrap the message handler to handle workspace protocol messages.
    // Cast once to accept enriched responses (with WorkspaceNotification/WorkspaceDelivered).
    const originalHandler = config.messageHandler as
      ((message: WorkspaceEnrichedResponse) => void) | undefined;

    config.messageHandler = (message: InternalServiceResponse) => {
      // Observation point for nextResponse(): every raw response passes here,
      // whether or not it is later enriched. Observers only look — the message
      // still flows to the original handler below. This is what lets callers
      // correlate a request with its response without touching the WASM stream
      // (calling next_message() while the client's own loop holds the stream
      // throws in the WASM guard; auth.getSession() used to do exactly that).
      if (self) {
        self.notifyResponseObservers(message);
      }

      // Check if this is a MessageNotification that contains workspace protocol
      if (isResponseType(message, 'MessageNotification')) {
        const notification = message.MessageNotification;

        // Workspace protocol is JSON; P2P chat is CBOR. Both arrive as
        // MessageNotification, so this used to JSON.parse every chat message,
        // throw, and warn — 83 warnings in a single integration run for
        // traffic that is behaving exactly as designed. A JSON document here
        // always starts with '{', and CBOR never does (its first byte is a
        // major-type tag), so one byte separates them without decoding
        // anything. Exceptions are for the unexpected; this was the norm.
        // Workspace traffic comes from the SERVER, not from a peer.
        //
        // The byte check below distinguishes JSON from CBOR, which separates
        // workspace protocol from chat under HONEST traffic — but it is not an
        // authenticity check. A peer can send raw JSON over the P2P channel and
        // land in the session manager below, where `{"Response":{"Error":"Not
        // in workspace"}}` clears the victim's workspace session and persisted
        // workspace id, and a `Workspace` variant repoints it. Any registered
        // peer could do that repeatedly.
        //
        // The frontend's message-extraction.ts already applies exactly this
        // guard; it was simply never applied here.
        const notificationPeer = (notification as { peer_cid?: bigint }).peer_cid;
        const notificationCid = (notification as { cid?: bigint }).cid;
        const fromServer =
          notificationPeer === undefined ||
          notificationPeer === null ||
          notificationPeer === BigInt(0) ||
          (notificationCid !== undefined && notificationPeer === notificationCid);

        if (!fromServer || !looksLikeWorkspaceJson(notification.message)) {
          if (originalHandler) {
            originalHandler(message);
          }
          return;
        }

        try {
          // Decode via the shared codec: fields the generated types declare as
          // `bigint` are revived from JSON numbers, so the runtime shape
          // matches the signature (a bare JSON.parse left them as `number`,
          // silently failing every strict comparison downstream).
          const workspacePayload: WorkspaceProtocolPayload = decodeWorkspacePayload(notification.message);

          // Handle workspace responses in session manager
          const payloadRecord = workspacePayload as Record<string, unknown>;
          if (self && self.session && isVariant(payloadRecord, 'Response')) {
            self.session.handleWorkspaceResponse(
              (workspacePayload as { Response: WorkspaceProtocolResponse }).Response
            );
          }

          // Create enriched message preserving original variant keys.
          // Downstream handlers (workspace-response-handler, instance-inbound-router)
          // check for MessageNotification — the spread keeps it accessible.
          const enrichedMessage = {
            ...message,
            WorkspaceNotification: {
              ...notification,
              payload: workspacePayload
            }
          };

          // Call the original handler with the enriched message
          if (originalHandler) {
            originalHandler(enrichedMessage);
          }
        } catch (e) {
          // Reached only when the payload LOOKED like workspace JSON and still
          // failed, which is a genuine anomaly rather than routine chat
          // traffic — so this stays a warning.
          console.warn('[WorkspaceClient] Failed to parse MessageNotification as workspace protocol:', e);
          if (originalHandler) {
            originalHandler(message);
          }
        }
      } else {
        // Pass through other messages unchanged. This includes any message
        // carrying a `MessageDelivered` key: no Rust crate in this tree emits
        // that variant, so the branch that used to parse it here was dead —
        // and it fed the session manager through an unguarded JSON.parse of
        // its `contents`. See the comment above WorkspaceNotificationEnriched.
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
   * Wait for the next InternalServiceResponse for which `extract` returns a
   * value, without touching the WASM message stream.
   *
   * Register the waiter BEFORE sending the request it correlates with, or the
   * response can arrive in the gap and be missed. The matched message is
   * observed, not consumed: it still reaches the configured messageHandler.
   *
   * This exists because calling nextMessage() for correlation cannot work:
   * the client's own processing loop holds the WASM stream, and the WASM
   * guard throws "next_message is already being called by another process"
   * on reentrancy — or, if the caller happens to win the race, it steals an
   * arbitrary message from the loop.
   *
   * @param extract Returns the extracted value for a matching message, or
   *                undefined to keep waiting. A throwing extractor is treated
   *                as a non-match.
   * @param timeoutMs Explicit timeout; rejects when it elapses with no match.
   */
  async nextResponse<T>(
    extract: (message: InternalServiceResponse) => T | undefined,
    timeoutMs: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const observer = (message: InternalServiceResponse): void => {
        let extracted: T | undefined;
        try {
          extracted = extract(message);
        } catch {
          // A predicate that throws on an unrelated message shape must not
          // abort the wait, and must never disturb delivery to other observers.
          return;
        }
        if (extracted !== undefined) {
          cleanup();
          resolve(extracted);
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for a matching response`));
      }, timeoutMs);
      const cleanup = (): void => {
        clearTimeout(timer);
        this.responseObservers.delete(observer);
      };
      this.responseObservers.add(observer);
    });
  }

  private notifyResponseObservers(message: InternalServiceResponse): void {
    // Copy first: a matching observer removes itself during iteration.
    for (const observer of Array.from(this.responseObservers)) {
      observer(message);
    }
  }

  /**
   * Send a workspace protocol request.
   *
   * RESOLVE-ON-SEND: the returned promise resolves when the request has been
   * handed to the transport — NOT when the server has processed it or
   * responded. The workspace protocol carries no request id (see the generated
   * WorkspaceProtocolRequest — no variant has one), so this layer cannot
   * correlate a response to this call; matching by response variant would
   * mis-resolve on server-pushed broadcasts of the same variant. Responses
   * arrive asynchronously through the configured messageHandler as enriched
   * WorkspaceNotification messages, and workspace/session state changes are
   * reflected via session.onWorkspaceSessionChange(). Real correlation needs a
   * request id added to the Rust protocol.
   *
   * Fields the generated types declare as `bigint` (e.g. `before_timestamp`)
   * are accepted as bigint and encoded as JSON numbers; a value that cannot
   * survive the JSON transport throws instead of being corrupted.
   *
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

    // Serialize via the shared codec: a bare JSON.stringify threw
    // "Do not know how to serialize a BigInt" for exactly the values the
    // generated signatures ask for (e.g. GetGroupMessages.before_timestamp).
    const messageBytes = encodeWorkspacePayload(payload);

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
   * Send a CreateWorkspace request. Resolves on send, not on creation —
   * see sendWorkspaceRequest for why no completion can be awaited here.
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
   * Send a GetWorkspace request. Resolves on send; the workspace itself
   * arrives later via the messageHandler (enriched WorkspaceNotification)
   * and session.onWorkspaceSessionChange — see sendWorkspaceRequest.
   */
  async getWorkspace(cid: string | bigint, workspaceId?: string): Promise<void> {
    await this.sendWorkspaceRequest(cid, {
      GetWorkspace: { workspace_id: workspaceId ?? null }
    });
  }

  /**
   * Send a ListWorkspaces request. Resolves on send; the list arrives later
   * via the messageHandler — see sendWorkspaceRequest.
   */
  async listWorkspaces(cid: string | bigint): Promise<void> {
    await this.sendWorkspaceRequest(cid, 'ListWorkspaces');
  }

  /**
   * Send a workspace Message request. Resolves on send, not on delivery —
   * see sendWorkspaceRequest.
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
   * Send one encoded media frame to a peer.
   *
   * Synchronous and unawaited on purpose. Frames arrive 30-60 times a second
   * per track; a promise per frame would allocate thousands of microtasks a
   * minute for a result nobody inspects, and there is nothing to await — a
   * frame that cannot be queued is one worth dropping, because a retry would
   * arrive too late to play.
   */
  sendMediaFrame(
    localCid: bigint,
    peerCid: bigint,
    track: number,
    kind: number,
    timestamp: number,
    flags: number,
    payload: Uint8Array,
  ): void {
    this.getWorkspaceWasmModule().send_media_frame(
      localCid.toString(),
      peerCid.toString(),
      track,
      kind,
      timestamp,
      flags,
      payload,
    );
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
