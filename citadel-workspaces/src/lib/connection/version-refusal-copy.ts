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

/**
 * The SDK's protocol-version refusal as an agent older than its code reports it: the server's
 * sentence and nothing else (its error 550's own form, "The other node speaks protocol X;
 * this node takes part only with Y or a later patch of that release. Update the older node").
 * Such an agent sends no `reason_code`, so its text is the only thing that says what happened.
 */
const VERSION_REFUSAL_TEXT: RegExp = /speaks protocol \S+; this node takes part only with \S+ or a later patch of that release/;

/** Whether `message` is a protocol-version refusal an agent passed on as text alone. */
export function isVersionRefusalText(message: string | null | undefined): boolean {
  return typeof message === 'string' && VERSION_REFUSAL_TEXT.test(message);
}

/**
 * The copy for a refusal: by `reason` when the agent names one of these, and for an agent
 * that names none, by the SDK's version-refusal sentence in `message`.
 */
export function versionRefusalCopyOf(reason: unknown, message: string | null | undefined): string | null {
  const named: string | null = versionRefusalCopy(reason);
  if (named !== null) return named;
  return (reason === null || reason === undefined) && isVersionRefusalText(message) ? VERSION_REFUSAL_COPY.protocol_version_unsupported : null;
}

/** The copy for `reason`, when it is one of these refusals. */
export function versionRefusalCopy(reason: unknown): string | null {
  return reason === 'protocol_version_unsupported' || reason === 'revfs_seal_unrecognised'
    ? VERSION_REFUSAL_COPY[reason]
    : null;
}
