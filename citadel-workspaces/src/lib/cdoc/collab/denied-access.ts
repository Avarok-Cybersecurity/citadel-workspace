/**
 * Which side of a document a refused permission guards: writing it or reading it. The page's
 * gates are EditMdx and ViewContent (the kernel's `documents::required_permission`); a chat
 * document's are its channel's, SendMessages and ViewContent (`required_channel_permission`).
 * The one map both refusal paths read, so a session cannot halt its writes over a read refusal.
 */
import type { Permission } from 'citadel-workspace-client-ts';

export type DeniedAccess = 'write' | 'read';

const ACCESS: Readonly<Partial<Record<Permission, DeniedAccess>>> = { EditMdx: 'write', SendMessages: 'write', ViewContent: 'read' };

export function accessOf(permission: Permission): DeniedAccess | null {
  return ACCESS[permission] ?? null;
}

/** A page's refusal is the protocol's plain `Error`: "Permission denied: EditMdx required". */
export function accessOfError(message: string): DeniedAccess | null {
  const named: string | undefined = /^Permission denied: (\w+) required/.exec(message)?.[1];
  return named !== undefined && Object.hasOwn(ACCESS, named) ? accessOf(named as Permission) : null;
}
