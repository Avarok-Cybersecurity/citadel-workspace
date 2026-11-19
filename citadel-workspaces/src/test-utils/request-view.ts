/**
 * A sent workspace request as a recorder reads it. The generated `WorkspaceProtocolRequest` is a
 * union, so `request.CreateNode` does not type-check on it; the view keys each variant's body
 * under its own optional name. A unit variant (`'ListWorkspaces'`) carries no body, so it views
 * as no keys at all.
 */
import type { WorkspaceProtocolRequest } from 'citadel-workspace-client-ts';
import type { WorkspaceRequestView } from '@/types/workspace-protocol';

export function viewOf(request: WorkspaceProtocolRequest): WorkspaceRequestView {
  return typeof request === 'string' ? {} : request;
}
