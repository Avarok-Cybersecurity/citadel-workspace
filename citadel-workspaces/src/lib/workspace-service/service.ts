/**
 * Workspace Service - Main Service Class
 *
 * Singleton service providing workspace protocol request methods.
 * Delegates operations to focused sub-modules.
 */

import type {
  WorkspaceProtocolPayloadTS,
  WorkspaceProtocolRequestTS,
  SentGroupMessageType,
  PermissionTS,
  UpdateOperationTS,
} from '@/types/workspace-protocol';
import { failOnSocketLoss } from '../websocket/request-response';
import { websocketService } from '@/lib/websocket-service';
import { isVariant , type MemberRole, type SignInSettings, type WorkspaceProtocolRequest } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import { debugLog, debugEnabled } from '@/lib/debug-config';

import { toWasmWorkspaceRequest } from './types';
import type { ProtocolSender } from './workspace-operations';
import * as ws from './workspace-operations';
import * as members from './member-operations';
import * as messaging from './messaging-operations';
import * as signals from './group-chat-signals';
import * as nodes from './node-operations';
import * as nodeTabs from './node-tabs-operations';
import { createDocument, type NewDocument } from './document-operations';
import * as signIn from './sign-in-settings';
import { updateWorkspaceProfile, type WorkspaceProfileChange } from './workspace-profile';

export class WorkspaceService implements ProtocolSender {
  private static instance: WorkspaceService;
  private _currentCid: bigint | null = null;

  private constructor() { }

  public static getInstance(): WorkspaceService {
    if (!WorkspaceService.instance) {
      WorkspaceService.instance = new WorkspaceService();
    }
    return WorkspaceService.instance;
  }

  get currentCid(): bigint | null { return this._currentCid; }

  public setConnectionId(cid: bigint): void {
    debugLog('WorkspaceService', '[WorkspaceService] setConnectionId called:', {
      newCid: cid.toString(),
      oldCid: this._currentCid?.toString() ?? 'null',
    });
    this._currentCid = cid;
  }

  public sendProtocolRequest(request: WorkspaceProtocolRequestTS): Promise<void> {
    return this.sendWorkspaceRequest({ Request: request });
  }

  public async sendWorkspaceRequest(payload: WorkspaceProtocolPayloadTS): Promise<void> {
    if (!this._currentCid) {
      throw new Error('No active connection available. Please connect first.');
    }
    try {
      debugLog('WorkspaceService', '[WorkspaceService] Sending payload:', payload);
      let request: WorkspaceProtocolRequest;
      if (isVariant(payload as Record<string, unknown>, 'Request') && payload.Request) {
        const tsRequest: WorkspaceProtocolRequestTS = payload.Request;
        if (isVariant(tsRequest as Record<string, unknown>, 'GetWorkspace')) {
          const wsReq: { workspace_id?: string | null; } | null | undefined = tsRequest.GetWorkspace;
          request = {
            GetWorkspace: {
              workspace_id: (wsReq && typeof wsReq === 'object' && 'workspace_id' in wsReq) ? wsReq.workspace_id ?? null : null
            }
          };
        } else if (typeof tsRequest === 'string' && tsRequest === 'ListWorkspaces') {
          request = 'ListWorkspaces';
        } else if (isVariant(tsRequest as Record<string, unknown>, 'CreateWorkspace')) {
          const req: { name: string; description: string; workspace_master_password: string; metadata?: number[]; } = tsRequest.CreateWorkspace!;
          request = {
            CreateWorkspace: {
              name: req.name,
              description: req.description,
              workspace_master_password: req.workspace_master_password,
              metadata: req.metadata ?? null
            }
          };
        } else if (isVariant(tsRequest as Record<string, unknown>, 'UpdateWorkspace')) {
          const req: { workspace_id?: string | null; name?: string; description?: string; workspace_master_password: string; metadata?: number[]; } = tsRequest.UpdateWorkspace!;
          request = {
            UpdateWorkspace: {
              workspace_id: req.workspace_id ?? null,
              name: req.name ?? null,
              description: req.description ?? null,
              workspace_master_password: req.workspace_master_password,
              metadata: req.metadata ?? null
            }
          };
        } else {
          request = toWasmWorkspaceRequest(tsRequest);
        }
      } else {
        throw new Error('Invalid workspace protocol payload');
      }
      await websocketService.sendWorkspaceRequest(this._currentCid, request);
      debugLog('WorkspaceService', '[WorkspaceService] Request sent successfully');
    } catch (error) {
      if (error instanceof Error) {
        debugLog('WorkspaceService', 'Error sending request:', error.message);
        throw error;
      } else {
        debugLog('WorkspaceService', 'Unknown error sending request:', error);
        throw new Error('An unknown error occurred while sending the workspace request.');
      }
    }
  }

  // Workspace operations
  public loadWorkspace(): Promise<void> { return ws.loadWorkspace(this); }
  public getWorkspace(id?: string): Promise<void> { return ws.getWorkspace(this, id); }
  public listWorkspaces(): Promise<void> { return ws.listWorkspaces(this); }
  public createWorkspace(n: string, d: string, p: string, m?: Uint8Array): Promise<void> { return ws.createWorkspace(this, n, d, p, m); }
  public updateWorkspace(n?: string, d?: string, p?: string, m?: Uint8Array): Promise<void> { return ws.updateWorkspace(this, n, d, p, m); }
  public updateWorkspaceTheme(theme: Uint8Array, workspaceId?: string): Promise<void> { return ws.updateWorkspaceTheme(this, theme, workspaceId); }
  public updateWorkspaceProfile(workspaceId: string, change: WorkspaceProfileChange): Promise<void> { return updateWorkspaceProfile(this, workspaceId, change); }

  // Member operations
  public addMember(userId: string, role: MemberRole, domainId?: string, metadata?: Uint8Array): Promise<void> { return members.addMember(this, userId, role, domainId, metadata); }
  public getMember(userId: string): Promise<void> { return members.getMember(this, userId); }
  public updateMemberRole(userId: string, role: MemberRole, metadata?: Uint8Array): Promise<unknown> { return members.updateMemberRole(this, userId, role, metadata); }
  public updateMemberPermissions(userId: string, domainId: string, perms: PermissionTS[], op: UpdateOperationTS): Promise<void> { return members.updateMemberPermissions(this, userId, domainId, perms, op); }
  public removeMember(userId: string, domainId?: string): Promise<void> { return members.removeMember(this, userId, domainId); }
  public listMembers(domainId?: string): Promise<void> { return members.listMembers(this, domainId); }
  public getUserPermissions(userId: string, domainId: string): Promise<void> { return members.getUserPermissions(this, userId, domainId); }

  // Messaging operations
  public sendMessage(contents: Uint8Array): Promise<void> { return messaging.sendMessage(this, contents); }
  public sendGroupMessage(gId: string, content: string, type?: SentGroupMessageType, replyTo?: string, mentions?: string[]): Promise<void> { return messaging.sendGroupMessage(this, gId, content, type, replyTo, mentions); }
  public editGroupMessage(gId: string, mId: string, content: string): Promise<void> { return messaging.editGroupMessage(this, gId, mId, content); }
  public deleteGroupMessage(gId: string, mId: string): Promise<void> { return messaging.deleteGroupMessage(this, gId, mId); }
  public getGroupMessages(gId: string, before?: number | bigint, limit?: number): Promise<void> { return messaging.getGroupMessages(this, gId, before, limit); }
  public getThreadMessages(gId: string, parentId: string): Promise<void> { return messaging.getThreadMessages(this, gId, parentId); }
  public reactGroupMessage(gId: string, mId: string, emoji: string, on: boolean): Promise<void> { return signals.reactGroupMessage(this, gId, mId, emoji, on); }
  public markGroupRead(gId: string, uptoId: string, member: string): Promise<void> { return signals.markGroupRead(this, gId, uptoId, member); }
  public groupTyping(gId: string): Promise<void> { return signals.groupTyping(this, gId); }
  public updateUserProfile(update: messaging.ProfileUpdate): Promise<void> { return messaging.updateUserProfile(this, update); }

  // Node operations
  public createNode(parentId: string | null, entityType: { Child: string } | 'Workspace', name: string, desc: string, opts?: { mdxContent?: string; metadata?: Uint8Array; isDefault?: boolean }): Promise<void> { return nodes.createNode(this, parentId, entityType, name, desc, opts); }
  public updateNode(nodeId: string, updates: { name?: string; description?: string; mdxContent?: string; rules?: string; chatEnabled?: boolean; isDefault?: boolean }): Promise<void> { return nodes.updateNode(this, nodeId, updates); }
  public createDocument(document: NewDocument): Promise<void> { return createDocument(this, document); }
  public setMembersVisible(nodeId: string, visible: boolean): Promise<void> { return nodes.setMembersVisible(this, nodeId, visible); }
  public writeNodeTabs(nodeId: string, appIds: readonly string[] | null): Promise<void> { return nodeTabs.writeNodeTabs(this, nodeId, appIds); }
  public setDefaultAppTabs(appIds: readonly string[]): Promise<void> { return nodeTabs.setDefaultAppTabs(this, appIds); }
  public deleteNode(nodeId: string, cascade?: boolean): Promise<void> { return nodes.deleteNode(this, nodeId, cascade); }
  public moveNode(nodeId: string, newParentId: string | null): Promise<void> { return nodes.moveNode(this, nodeId, newParentId); }
  public listNodes(parentId?: string | null, entityTypes?: Array<{ Child: string } | 'Workspace'>): Promise<void> { return nodes.listNodes(this, parentId, entityTypes); }
  public getTreeStructure(rootId?: string, maxDepth?: number): Promise<void> { return nodes.getTreeStructure(this, rootId, maxDepth); }
  public getTreeSchema(): Promise<void> { return nodes.getTreeSchema(this); }
  public getServerCapabilities(): Promise<void> { return nodes.getServerCapabilities(this); }
  public getSignInSettings(): Promise<SignInSettings> { return signIn.getSignInSettings(this); }
  public updateSignInSettings(settings: SignInSettings): Promise<SignInSettings> { return signIn.updateSignInSettings(this, settings); }

  public cleanup(): void { /* Any cleanup needed */ }

  // ========== Raw Protocol Request (for testing) ==========

  public async sendRequest(request: WorkspaceProtocolRequest, timeoutMs: number = 15000): Promise<unknown> {
    if (!this._currentCid) {
      throw new Error('No active connection available. Please connect first.');
    }
  // Guarded: stringifies the entire request and then keeps 200 chars of it,
  // on every workspace request, for a logger production compiles away.
  if (debugEnabled) {
    debugLog('WorkspaceService', '[WorkspaceService] sendRequest (raw):', JSON.stringify(request).substring(0, 200));
  }
    const requestType: string = typeof request === 'string' ? request : Object.keys(request)[0];
    const expectedResponseTypes: string[] = this.getExpectedResponseTypes(requestType);

    const responsePromise: Promise<unknown> = new Promise<unknown>((resolve, reject): void => {
      const timeoutId: NodeJS.Timeout = setTimeout((): void => {
        eventEmitter.off('workspace:raw-response', handler);
        reject(new Error(`Request timed out after ${timeoutMs}ms waiting for response to ${requestType}`));
      }, timeoutMs);

      const handler = (response: unknown): void => {
        if (response && typeof response === 'object') {
          const responseType: string = Object.keys(response)[0];
          if (expectedResponseTypes.includes(responseType) || responseType === 'Error') {
            clearTimeout(timeoutId);
            eventEmitter.off('workspace:raw-response', handler);
            resolve(response);
          }
        }
      };
      eventEmitter.on('workspace:raw-response', handler);
    });

    await websocketService.sendWorkspaceRequest(this._currentCid, request);
    return failOnSocketLoss(requestType, responsePromise);
  }

  private getExpectedResponseTypes(requestType: string): string[] {
    const mapping: Record<string, string[]> = {
      CreateNode: ['Node'], GetNode: ['Node'], UpdateNode: ['Node'],
      DeleteNode: ['NodeDeleted'], MoveNode: ['NodeMoved'],
      ListNodes: ['Nodes'], GetTreeStructure: ['TreeStructure'],
      GetTreeSchema: ['TreeSchema'], UpdateTreeSchema: ['TreeSchema', 'Success'],
      CreateNodeType: ['NodeTypes', 'Success'], ListNodeTypes: ['NodeTypes'],
      GetWorkspace: ['Workspace', 'WorkspaceNotInitialized'],
      ListWorkspaces: ['Workspaces'], CreateWorkspace: ['Workspace'],
      UpdateWorkspace: ['Workspace', 'Success'],
      AddMember: ['Member', 'Success'], RemoveMember: ['Success'],
      UpdateMemberRole: ['MemberRoleUpdated', 'Success'],
      ListMembers: ['Members'],
    };
    return mapping[requestType] || ['Success'];
  }
}
