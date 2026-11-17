/**
 * Where an account link opens once the account is (`?open=`): what a native
 * notice was about. The target is an id or a fixed word, never content, so a
 * link carries nothing a history entry or a log line should not.
 *
 * The landing page reads it before the workspace exists, so it is stashed
 * here and taken by whichever part of the workspace opens that kind of thing
 * (NotificationCenter for conversations, calls and requests; TopBar for the
 * settings), once.
 */
export type LinkTarget =
  | { readonly kind: 'conversation' | 'call'; readonly peerCid: bigint }
  | { readonly kind: 'requests' }
  | { readonly kind: 'settings' };

const U64_MAX: bigint = 18446744073709551615n;
const PEER_TARGET: RegExp = /^(conversation|call):([1-9][0-9]{0,19})$/;

/** The target `raw` names, or null for anything else. */
export function parseLinkTarget(raw: string): LinkTarget | null {
  if (raw === 'requests') return { kind: 'requests' };
  if (raw === 'settings:notifications') return { kind: 'settings' };
  const match: RegExpExecArray | null = PEER_TARGET.exec(raw);
  if (!match) return null;
  const peerCid: bigint = BigInt(match[2]);
  if (peerCid > U64_MAX) return null;
  return { kind: match[1] === 'call' ? 'call' : 'conversation', peerCid };
}

let pending: LinkTarget | null = null;

export function stashLinkTarget(target: LinkTarget): void {
  pending = target;
}

/** The stashed target if it is one of `kinds`; it is gone afterwards. */
export function takeLinkTarget<K extends LinkTarget['kind']>(kinds: readonly K[]): Extract<LinkTarget, { kind: K }> | null {
  const target: LinkTarget | null = pending;
  if (!target || !(kinds as readonly string[]).includes(target.kind)) return null;
  pending = null;
  return target as Extract<LinkTarget, { kind: K }>;
}
