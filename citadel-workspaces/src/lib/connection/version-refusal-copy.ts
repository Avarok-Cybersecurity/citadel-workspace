/**
 * What the page says when the server refused for a reason only an update fixes: the SDK's
 * protocol-version refusal (550) and its unreadable RE-VFS seal (495), as the agent names them.
 */
import type { FailureReason } from 'citadel-workspace-client-ts';

export const VERSION_REFUSAL_COPY = {
  protocol_version_unsupported:
    'This workspace server runs a different version of Citadel than the agent on this computer. Update the Citadel agent, or ask the workspace admin to update the server.',
  revfs_seal_unrecognised:
    'Your files on this workspace server are stored in a format this version of Citadel cannot read. Update the Citadel agent, or ask the workspace admin.',
} as const satisfies Partial<Record<FailureReason, string>>;

/** The copy for `reason`, when it is one of these refusals. */
export function versionRefusalCopy(reason: unknown): string | null {
  return reason === 'protocol_version_unsupported' || reason === 'revfs_seal_unrecognised'
    ? VERSION_REFUSAL_COPY[reason]
    : null;
}
