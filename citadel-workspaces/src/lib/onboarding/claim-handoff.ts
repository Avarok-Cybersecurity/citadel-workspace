/**
 * The claim code, from the moment the control plane issues it to the moment it
 * makes someone the workspace's owner.
 *
 * IN MEMORY ONLY. The code grants ownership of a workspace to whoever presents
 * it, and the control plane returns it exactly once. Written to localStorage or
 * sessionStorage it would outlive the tab, be readable by any script on the
 * origin, and sit on disk; kept in a module variable it dies with the page,
 * which is the lifetime it should have. A reload loses it -- deliberately. The
 * visitor was told to store it, and the initialization dialog still accepts it
 * typed.
 *
 * Two readers, two rules:
 *
 *   - The claim screen DISPLAYS it at most once (`revealClaimCode`). Returning
 *     to that screen shows that it was already shown, not the code again: a
 *     secret shown once is only "shown once" if the second look is refused.
 *   - The initialization dialog PRE-FILLS it (`claimCodeFor`), into a password
 *     field, only for the workspace it was issued for, and it is forgotten once
 *     that dialog succeeds.
 */
import { normalizeWorkspaceAddress } from '@/lib/workspace-address';
import { dialledHost } from '@/lib/sessions/same-server';

interface Issued {
  readonly workspaceHost: string;
  readonly claimCode: string | undefined;
  revealed: boolean;
}

let issued: Issued | undefined;

/** Record a newly created workspace. A code of `undefined` means it was issued earlier, elsewhere. */
export function recordIssuedClaim(workspaceHost: string, claimCode: string | undefined): void {
  issued = { workspaceHost, claimCode, revealed: false };
}

/**
 * The code to show, the first time this is asked; `undefined` every time after,
 * and when none was issued in this page's life.
 */
export function revealClaimCode(): string | undefined {
  if (!issued || issued.revealed) return undefined;
  issued.revealed = true;
  return issued.claimCode;
}

/** The address the join wizard should offer: the workspace just created, if any. */
export function createdWorkspaceAddress(): string | undefined {
  return issued ? normalizeWorkspaceAddress(issued.workspaceHost) : undefined;
}

/** The claim code for `serverAddress`, if it is the workspace this page created. */
export function claimCodeFor(serverAddress: string | undefined): string | undefined {
  if (!issued || !serverAddress) return undefined;
  return sameWorkspace(serverAddress, issued.workspaceHost) ? issued.claimCode : undefined;
}

/**
 * Whether two spellings name one workspace. The tab's connection holds the
 * DIALLED form (`wss://acme.work.avarok.net/`) and the issued record the host,
 * and normalizing leaves a URL as it is -- so the two never matched and the
 * claim code was never pre-filled, even straight from "Open your workspace".
 * Both are reduced to what was dialled; a different port is still different.
 */
function sameWorkspace(a: string, b: string): boolean {
  const key: (x: string) => string = (x: string): string => dialledHost(normalizeWorkspaceAddress(x)).toLowerCase();
  return key(a) === key(b);
}

/** Drop everything: the claim succeeded, or the visitor started over. */
export function forgetIssuedClaim(): void {
  issued = undefined;
}
