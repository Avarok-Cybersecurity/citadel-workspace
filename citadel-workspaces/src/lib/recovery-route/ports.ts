/**
 * The only place a route touches the world (SBIO). Each port reuses a mechanism that already
 * exists; components/recovery-route/use-recovery-ports.ts wires them, a test supplies fakes.
 */
import type { SettingsTab } from '@/lib/settings-request';
import type { AccountRef, OtherMember } from './binding';
import type { AdminRequestKind, BrowserPermission, Destination } from './route';

/** What asking the admins came to, as the surface reports it under its controls. */
export type AskOutcome =
  | { readonly kind: 'sent'; readonly admins: number }
  | { readonly kind: 'refused'; readonly sentence: string };

export interface RecoveryPorts {
  /** Reloads this window, keeping unsent drafts (lib/chat/draft-handoff.ts). */
  reload(): void;
  /** Reloads into the build that is deployed now. */
  applyUpdate(): void;
  openSettings(tab: SettingsTab): void;
  navigate(to: Destination): void;
  signIn(account: AccountRef): void;
  installAgent(reason: 'missing' | 'outdated'): void;
  requestPermission(permission: BrowserPermission): void;
  askAdmins(request: AdminRequestKind, about: string): Promise<AskOutcome>;
  openChat(member: OtherMember, draft: string): void;
  /** Opens the bug reporter, attributed to the surface it was opened from. */
  reportBug(surface: string): void;
}
