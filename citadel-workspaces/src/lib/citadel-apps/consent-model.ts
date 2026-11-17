/**
 * What the consent screen lists, decided from the manifest, the installer's permissions and the
 * optional capabilities they turned off: one row per requested capability (its words, the
 * publisher's reason, its risk, its hosts one by one), what the app can never do, whose key this
 * is, and exactly what Install would grant. `check_grant` (rules.rs) is the control.
 */
import type { AppInstall, AppManifest, Capability, CapabilityRequest, PeerConsent } from 'citadel-workspace-client-ts';
import { PERMISSION_LABELS } from '@/lib/permissions-service/types';
import { CAPABILITY_COPY, FIRST_PARTY_ONLY, MEMBER_CONSENT_COPY, NETWORK_CAPABILITIES, PEER_METADATA_DISCLOSURE, type Risk } from './capability-copy';
import type { ConsentPlane } from './member-consent-types';
import type { Authority } from './scope-options';

export interface ConsentRow {
  cap: Capability;
  label: string;
  why: string;
  risk: Risk;
  optional: boolean;
  /** Whether it is in the grant: required ones always, optional ones unless turned off. */
  on: boolean;
  /** Why the installer cannot grant it; null when they can. */
  blocked: string | null;
  /** The hosts of a network capability, each shown on its own; empty otherwise. */
  hosts: string[];
  /** For a capability each member also allows for themselves: says so, and what the server sees; null otherwise. */
  memberNote: string | null;
}

/** Under an installer's row for a per-member capability. */
export function memberNoteFor(cap: Capability): string | null {
  if (MEMBER_CONSENT_COPY[cap] === undefined) return null;
  const asked: string = 'Each member is also asked, and can turn it off for themselves.';
  return cap === 'ihttp.p2p.serve' || cap === 'ihttp.p2p.call' ? `${asked} ${PEER_METADATA_DISCLOSURE}` : asked;
}

export function consentRows(manifest: AppManifest, turnedOff: ReadonlySet<Capability>, authority: Authority, domain: string): ConsentRow[] {
  return manifest.capabilities.map((r: CapabilityRequest): ConsentRow => {
    const copy: (typeof CAPABILITY_COPY)[Capability] = CAPABILITY_COPY[r.cap];
    const held: string = authority.holds(copy.installerNeeds, domain);
    const blocked: string | null = FIRST_PARTY_ONLY.has(r.cap)
      ? 'Only apps published by Avarok may have this.'
      : held === 'no' ? `You need “${PERMISSION_LABELS[copy.installerNeeds]}” to allow this.`
      : held === 'unknown' ? 'Checking your permissions…' : null;
    return {
      cap: r.cap, label: copy.label, why: r.why, risk: copy.risk, optional: r.optional,
      on: !r.optional || (!turnedOff.has(r.cap) && blocked === null), blocked, hosts: r.hosts ?? [], memberNote: memberNoteFor(r.cap),
    };
  });
}

/** The capabilities Install sends: every row that is on. */
export const grantOf = (rows: readonly ConsentRow[]): Capability[] => rows.filter((r: ConsentRow) => r.on).map((r: ConsentRow) => r.cap);

/** Why Install cannot be pressed whatever the person does: a required row they cannot grant. */
export function grantProblem(rows: readonly ConsentRow[]): string | null {
  const stuck: ConsentRow | undefined = rows.find((r: ConsentRow) => !r.optional && r.blocked !== null);
  if (stuck !== undefined) return `This app needs “${stuck.label}”, which you cannot allow. ${stuck.blocked}`;
  const on: Set<Capability> = new Set(grantOf(rows));
  if (on.has('net.host.private') && !on.has('net.host')) return 'Reaching the local network needs reaching websites from each person’s computer too.';
  return null;
}

/** What an app is never given, whatever it asks: none of these is a capability. */
export function canNever(rows: readonly ConsentRow[]): string[] {
  const never: string[] = [
    'Change roles or who may do what',
    'Change who can see a page',
    'Read other workspaces',
    'See your password, keys or sign-in',
    'Read or change secure links',
  ];
  if (!rows.some((r: ConsentRow) => r.on && NETWORK_CAPABILITIES.has(r.cap))) never.push('Reach the internet or your network');
  return never;
}

export type KeyTrust = { kind: 'first-time' } | { kind: 'known'; apps: number };

/** Whether this person already trusts the publisher key: the apps they use pinned under it. */
export function keyTrust(publicKey: string, installs: readonly AppInstall[], appId: string): KeyTrust {
  const apps: Set<string> = new Set(installs.filter((i: AppInstall) => i.pinned_publisher_key === publicKey && i.app_id !== appId).map((i: AppInstall) => i.app_id));
  return apps.size === 0 ? { kind: 'first-time' } : { kind: 'known', apps: apps.size };
}

export function keyTrustCopy(trust: KeyTrust): string {
  if (trust.kind === 'first-time') return 'This is the first time you trust this publisher key.';
  return `Same key as ${trust.apps} ${trust.apps === 1 ? 'app' : 'apps'} you already use.`;
}

/** The capabilities each plane of a member's consent covers. */
export const PLANE_CAPABILITIES: Readonly<Record<ConsentPlane, readonly Capability[]>> = {
  serve: ['ihttp.p2p.serve'],
  call: ['ihttp.p2p.call'],
  topics: ['group.topic.subscribe', 'group.topic.publish'],
};

const PLANES: readonly ConsentPlane[] = ['serve', 'call', 'topics'];

/** One question a member answers for themselves: its words, whether the server sees metadata, and their answer. */
export interface MemberAsk {
  readonly plane: ConsentPlane;
  readonly copy: string;
  /** Said under the P2P planes: the server sees who, when and how much, never the content. */
  readonly disclosure: string | null;
  /** null: not answered yet. */
  readonly allowed: boolean | null;
}

/**
 * The planes this install was granted, each with this member's answer; a plane not granted is not
 * asked. A record with `at_ms` 0 was never answered (it holds only blocks).
 */
export function memberAsks(granted: readonly Capability[], consent: PeerConsent | null): MemberAsk[] {
  const held: Set<Capability> = new Set(granted);
  return PLANES.filter((plane: ConsentPlane) => PLANE_CAPABILITIES[plane].some((c: Capability) => held.has(c))).map((plane: ConsentPlane): MemberAsk => ({
    plane,
    copy: PLANE_CAPABILITIES[plane].filter((c: Capability) => held.has(c)).map((c: Capability) => MEMBER_CONSENT_COPY[c] as string).join(' '),
    disclosure: plane === 'topics' ? null : PEER_METADATA_DISCLOSURE,
    allowed: consent === null || consent.at_ms === 0n ? null : consent[plane],
  }));
}

/** Whether the member must be asked before the app mounts for them: a granted plane they never answered. */
export const needsMemberPrompt = (asks: readonly MemberAsk[]): boolean => asks.some((a: MemberAsk) => a.allowed === null);

/**
 * The granted capabilities in force for this member: a plane they did not allow is not, and an
 * install they turned off for themselves holds nothing. The kernel computes the same (the
 * fifth input of the effective set); the page uses it to refuse at once, never as the authority.
 */
export function effectiveForMember(granted: readonly Capability[], consent: PeerConsent | null, disabledForMe: boolean): Capability[] {
  if (disabledForMe) return [];
  const withheld: Set<Capability> = new Set(PLANES.filter((p: ConsentPlane) => consent === null || !consent[p]).flatMap((p: ConsentPlane) => PLANE_CAPABILITIES[p]));
  return granted.filter((c: Capability) => !withheld.has(c));
}

/** The whole answer to send when the member changes one plane; an unanswered plane is sent as not allowed. */
export function consentWith(consent: PeerConsent | null, plane: ConsentPlane, allowed: boolean): { serve: boolean; call: boolean; topics: boolean } {
  const base: { serve: boolean; call: boolean; topics: boolean } = { serve: consent?.serve ?? false, call: consent?.call ?? false, topics: consent?.topics ?? false };
  return { ...base, [plane]: allowed };
}

/** A username a block list may hold: what the server accepts as one (non-empty, no spaces, at most 64). */
export function blockableUsername(input: string): string | null {
  const name: string = input.trim();
  return name.length > 0 && name.length <= 64 && !/\s/.test(name) ? name : null;
}

/** The block list after blocking or unblocking `username`: sorted, each once. */
export function blockedAfter(blocked: readonly string[], username: string, block: boolean): string[] {
  const next: Set<string> = new Set(blocked);
  if (block) next.add(username); else next.delete(username);
  return [...next].sort();
}
