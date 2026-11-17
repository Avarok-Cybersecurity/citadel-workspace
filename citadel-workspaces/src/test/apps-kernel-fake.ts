/**
 * A contract fake of the kernel's apps handler, for marketplace tests: it keeps listings (some
 * outside the caller's audience), installs and the caller's permissions, and answers each
 * `AppsRequest` with the raw `AppsResponse` the kernel would send -- which then goes through the
 * production reader (wire/apps-answer.ts), so a test exercises the same parsing a real answer
 * takes. Its rules are written out here, not imported from the UI, so it cannot agree with the UI
 * by construction. `apps-operations-contract.test.ts` runs it through the protocol transport too.
 */
import type { AppInstall, AppListing, AppManifest, AppsRequest, Capability, InstallScope, ListingOffer, PeerConsent, PeerForMe } from 'citadel-workspace-client-ts';
import type { AppsTransport } from '@/lib/workspace-service/apps-operations';
import { readAppsAnswer, type AppsAnswer } from '@/lib/citadel-apps/wire/apps-answer';
import { readManifestBytes } from '@/lib/citadel-apps/manifest/manifest-rules';
import { installOf } from './app-manifests';

const INSTALLER_NEEDS: Partial<Record<Capability, string>> = {
  'nodes.read': 'AppInstallAllowNodeRead', 'storage.user': 'AppInstallAllowStorage', 'net.server': 'AppInstallAllowServerNetwork',
  'net.host': 'AppInstallAllowHostNetwork', 'ihttp.serve': 'AppInstallAllowInternalServe', 'ihttp.call': 'AppInstallAllowInternalCall',
  'ihttp.p2p.serve': 'AppInstallAllowPeerServe', 'ihttp.p2p.call': 'AppInstallAllowPeerCall',
  'group.topic.subscribe': 'AppInstallAllowGroupTopics', 'group.topic.publish': 'AppInstallAllowGroupTopics',
  'md.edit': 'AppInstallAllowMdEdit', 'files.read': 'AppInstallAllowFiles',
};

export interface FakeKernelWorld {
  me: string;
  visible: AppListing[];
  /** Listings that exist but whose audience does not admit the caller. */
  hidden: AppListing[];
  installs: AppInstall[];
  permissions: Set<string>;
  /** Install ids the caller turned off for themselves, kept as the kernel keeps them (user_apps). */
  disabled: Set<string>;
}

type Raw = unknown;

export class FakeAppsKernel implements AppsTransport {
  readonly requests: AppsRequest[] = [];
  /** Answers to send instead of the modelled one, first in first out (for malformed answers). */
  readonly scripted: Raw[] = [];
  /** The caller's own P2P answers and block lists (user_apps peer_for_me), as the kernel keeps them. */
  readonly peer: Map<string, PeerForMe> = new Map<string, PeerForMe>();
  /** The listing each install runs when it came from a signed listing (in no registry), by install id: what GetRelease answers. */
  readonly releases: Map<string, AppListing> = new Map<string, AppListing>();
  private gate: Promise<void> | null = null;
  private release: (() => void) | null = null;

  constructor(readonly world: FakeKernelWorld) {}

  /** Hold every answer until `resume()`, to see the in-progress states. */
  pause(): void { this.gate = new Promise<void>((r: () => void) => { this.release = r; }); }
  resume(): void { this.release?.(); this.gate = null; }

  async request(request: AppsRequest, isOurs: (answer: AppsAnswer) => boolean): Promise<AppsAnswer> {
    this.requests.push(request);
    if (this.gate !== null) await this.gate;
    const raw: Raw = this.scripted.length > 0 ? this.scripted.shift() : this.answer(request);
    const answer: AppsAnswer = readAppsAnswer(raw);
    if (!isOurs(answer)) throw new Error(`the fake kernel's answer ${JSON.stringify(answer.kind)} was not taken as the answer to ${JSON.stringify(request)}`);
    return answer;
  }

  private manifestOf(listing: AppListing): AppManifest {
    const r: ReturnType<typeof readManifestBytes> = readManifestBytes(Uint8Array.from(listing.manifest_bytes));
    if (!r.ok) throw new Error(`a fake listing does not read: ${r.field}`);
    return r.manifest;
  }

  private find(appId: string): { listing: AppListing; manifest: AppManifest } | null {
    for (const listing of this.world.visible) {
      const manifest: AppManifest = this.manifestOf(listing);
      if (manifest.id === appId) return { listing, manifest };
    }
    return null;
  }

  answer(request: AppsRequest): Raw {
    const w: FakeKernelWorld = this.world;
    if (request === 'ListCatalogue') return { Catalogue: { listings: w.visible } };
    if (request === 'ListInstalls') return { Installs: { installs: w.installs, disabled_for_me: w.installs.filter((i: AppInstall) => w.disabled.has(i.id)).map((i: AppInstall) => i.id), peer_for_me: [...this.peer.values()] } };
    if (typeof request !== 'object') return { Refused: 'Policy' };
    if ('GetListing' in request) {
      const found: { listing: AppListing } | null = this.find(request.GetListing.app_id);
      return found === null ? { Refused: 'Unavailable' } : { Listing: { listing: found.listing } };
    }
    if ('Install' in request) return this.install(request.Install);
    if ('GetRelease' in request) {
      const id: string = request.GetRelease.install_id;
      const current: AppListing | undefined = this.releases.get(id);
      return current === undefined || !w.installs.some((i: AppInstall) => i.id === id) ? { Refused: 'Unavailable' } : { Release: { install_id: id, current, waiting_on: null } };
    }
    if ('Uninstall' in request) {
      const id: string = request.Uninstall.install_id;
      if (!w.installs.some((i: AppInstall) => i.id === id)) return { Refused: 'Unavailable' };
      w.installs = w.installs.filter((i: AppInstall) => i.id !== id);
      return { Uninstalled: { install_id: id } };
    }
    if ('SetDisabledForMe' in request) {
      const { install_id, disabled } = request.SetDisabledForMe;
      if (!w.installs.some((i: AppInstall) => i.id === install_id)) return { Refused: 'Unavailable' };
      if (disabled) w.disabled.add(install_id); else w.disabled.delete(install_id);
      return { DisabledForMe: { install_id, disabled } };
    }
    if ('SetPeerConsentForMe' in request) {
      const { install_id, serve, call, topics } = request.SetPeerConsentForMe;
      if (!w.installs.some((i: AppInstall) => i.id === install_id)) return { Refused: 'Unavailable' };
      const consent: PeerConsent = { serve, call, topics, at_ms: BigInt(this.requests.length) };
      this.peer.set(install_id, { install_id, consent, blocked: this.peer.get(install_id)?.blocked ?? [] });
      return { PeerConsentForMe: { install_id, consent } };
    }
    if ('SetPeerBlockedForMe' in request) {
      const { install_id, username, blocked } = request.SetPeerBlockedForMe;
      if (!w.installs.some((i: AppInstall) => i.id === install_id)) return { Refused: 'Unavailable' };
      const prior: PeerForMe = this.peer.get(install_id) ?? { install_id, consent: { serve: false, call: false, topics: false, at_ms: 0n }, blocked: [] };
      this.peer.set(install_id, { ...prior, blocked: blocked ? [...new Set([...prior.blocked, username])] : prior.blocked.filter((u: string) => u !== username) });
      return { PeerBlockedForMe: { install_id, username, blocked } };
    }
    if ('Update' in request) return { UpToDate: { install_id: request.Update.install_id } };
    if ('RequestInstall' in request) return 'InstallRequested';
    return { Refused: 'Policy' };
  }

  /** Whether `offer` names `listing` as the kernel resolves one (apps_offer.rs `resolve_offer`). */
  private offers(offer: ListingOffer, listing: AppListing): boolean {
    if ('Registry' in offer) return typeof listing.source === 'object' && 'WorkspaceRegistry' in listing.source && listing.source.WorkspaceRegistry.entry_id === offer.Registry.entry_id;
    return offer.Signed.signature === listing.signature && offer.Signed.manifest_bytes.join() === listing.manifest_bytes.join();
  }

  private install(req: Extract<AppsRequest, { Install: unknown }>['Install']): Raw {
    const found: { listing: AppListing; manifest: AppManifest } | null = this.find(req.app_id);
    if (found === null || !this.offers(req.listing, found.listing)) return { Refused: 'Unavailable' };
    const m: AppManifest = found.manifest;
    const scope: InstallScope = req.scope;
    const kind: string = scope === 'Workspace' ? 'workspace' : 'SelfOnly' in scope ? 'self' : 'Node' in scope ? 'node' : 'NodeTree' in scope ? 'node_tree' : 'users';
    if (!(m.scopes as string[]).includes(kind)) return { Refused: 'ScopeNotSupported' };
    const needed: string = kind === 'self' ? 'AppInstall' : 'AppInstallScoped';
    if (!this.world.permissions.has(needed)) return { Refused: { PermissionRequired: needed } };
    for (const c of req.granted) {
      if (!m.capabilities.some((r: { cap: Capability }) => r.cap === c)) return { Refused: { NotRequested: c } };
      const p: string | undefined = INSTALLER_NEEDS[c];
      if (p !== undefined && !this.world.permissions.has(p)) return { Refused: { CapabilityNotGrantable: c } };
    }
    const leftOut: { cap: Capability } | undefined = m.capabilities.find((r: { cap: Capability; optional: boolean }) => !r.optional && !req.granted.includes(r.cap));
    if (leftOut !== undefined) return { Refused: { RequiredCapabilityLeftOut: leftOut.cap } };
    if (req.pinned_publisher_key !== m.publisher.mldsa65_public_key) return { Refused: 'BadSignature' };
    const install: AppInstall = installOf(m.id, scope, { version: m.version, granted: req.granted, installed_by: this.world.me });
    this.world.installs = [...this.world.installs, install];
    return { Installed: { install } };
  }
}
