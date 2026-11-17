/**
 * The secure-link requests bound to this tab's workspace session. Components and hooks import
 * this rather than the sender-taking operations, so a test replaces the one I/O boundary.
 */
import WorkspaceService from '@/lib/workspace-service';
import * as ops from '@/lib/workspace-service/secure-links-operations';

export interface SecureLinksApi {
  list: () => Promise<ops.SecureLinksListing>;
  create: (link: ops.NewSecureLink) => Promise<ops.CreateOutcome>;
  regenerate: (id: string) => Promise<ops.RegenerateOutcome>;
  extend: (id: string, ttlMs: bigint) => Promise<ops.ExtendOutcome>;
  remove: (id: string) => Promise<ops.DeleteOutcome>;
  resolve: (token: string) => Promise<ops.ResolveOutcome>;
  /** Whether the session can carry a request yet. */
  ready: () => boolean;
}

export const secureLinksApi: SecureLinksApi = {
  list: () => ops.listSecureLinks(WorkspaceService),
  create: (link: ops.NewSecureLink) => ops.createSecureLink(WorkspaceService, link),
  regenerate: (id: string) => ops.regenerateSecureLink(WorkspaceService, id),
  extend: (id: string, ttlMs: bigint) => ops.extendSecureLink(WorkspaceService, id, ttlMs),
  remove: (id: string) => ops.deleteSecureLink(WorkspaceService, id),
  resolve: (token: string) => ops.resolveSecureLink(WorkspaceService, token),
  ready: (): boolean => WorkspaceService.currentCid !== null,
};
