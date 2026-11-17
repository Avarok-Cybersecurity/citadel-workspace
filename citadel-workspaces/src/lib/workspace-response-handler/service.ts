/**
 * Workspace Response Handler - Service
 *
 * Singleton that listens for WebSocket messages, extracts workspace
 * protocol responses, and delegates to the appropriate handler group.
 */

import { eventEmitter } from '@/lib/event-emitter';
import { debugLog, debugEnabled } from '@/lib/debug-config';
import { isVariant, type WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import { redactDocumentsForDebug } from './documents-debug';

import { extractWorkspaceResponse } from './message-extraction';
import { handleWorkspaceVariants, buildConnectionInfo } from './workspace-handlers';
import { handleGroupVariants } from './group-handlers';
import { formatForDebug } from '@/lib/debug-formatter';

/**
 * Handles workspace protocol responses and emits appropriate events.
 */
export class WorkspaceResponseHandler {
  private static instance: WorkspaceResponseHandler;

  private constructor() {
    this.setupMessageHandler();
  }

  public static getInstance(): WorkspaceResponseHandler {
    if (!WorkspaceResponseHandler.instance) {
      WorkspaceResponseHandler.instance = new WorkspaceResponseHandler();
    }
    return WorkspaceResponseHandler.instance;
  }

  private setupMessageHandler(): void {
    eventEmitter.on('websocket-message', (raw: unknown) => {
      const response: WorkspaceProtocolResponse | null = extractWorkspaceResponse(raw);
      if (response) {
        this.processWorkspaceResponse(response);
      }
    });
  }

  private processWorkspaceResponse(response: WorkspaceProtocolResponse): void {
    // Through formatForDebug, which redacts secret-named fields: an IceServers
    // answer carries a TURN `credential`. Guarded: the walk is not free.
    // A Documents answer's bytes are the document itself: its log shows lengths (documents-debug.ts).
    if (debugEnabled) debugLog('WorkspaceResponseHandler', 'Processing workspace response', isVariant(response, 'Documents') ? redactDocumentsForDebug(response.Documents) : formatForDebug(response));
    const connectionInfo: ReturnType<typeof buildConnectionInfo> = buildConnectionInfo();

    // Try workspace/member/node/permission handlers
    if (handleWorkspaceVariants(response, connectionInfo)) return;

    // Try group messaging handlers
    if (handleGroupVariants(response, connectionInfo)) return;

    // Unhandled
    if (debugEnabled) debugLog('WorkspaceResponseHandler', 'Unhandled response type:', formatForDebug(response));
    eventEmitter.emit('workspace:raw-response', response);
  }

  /**
   * Emit loading events before making requests.
   */
  public emitLoadingEvent(eventType: string, data?: { domainId?: string }): void {
    const connectionInfo: ReturnType<typeof buildConnectionInfo> = buildConnectionInfo();

    switch (eventType) {
      case 'workspace:loading':
        eventEmitter.emit('workspace:loading', connectionInfo);
        break;
      case 'nodes:loading':
        eventEmitter.emit('nodes:loading', connectionInfo);
        break;
      case 'members:loading':
        eventEmitter.emit('members:loading', {
          domainId: data?.domainId,
          connection: connectionInfo,
        });
        break;
    }
  }
}
