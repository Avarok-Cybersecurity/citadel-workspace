/**
 * Citadel Apps on the workspace protocol (`WorkspaceProtocolRequest::Apps`), over an injected
 * transport so the marketplace is tested against a contract fake of the kernel.
 *
 * Every request is answered with `WorkspaceProtocolResponse::Apps`; the protocol has no request
 * id, so an answer is taken for ours only when its kind fits the request and, where it names an
 * app or an install, names ours (the secure-links-operations pattern). Answers are read strictly
 * (citadel-apps/wire/apps-answer.ts): one that is not exactly a known shape is a refusal.
 */
import type { AppInstall, AppListing, AppsRefusal, AppsRequest, Capability, InstallScope, ListingOffer, PeerForMe } from 'citadel-workspace-client-ts';
import { readAppsAnswer, type AppsAnswer } from '@/lib/citadel-apps/wire/apps-answer';
import { readManifestBytes, type ManifestReading } from '@/lib/citadel-apps/manifest/manifest-rules';
import { debugLog } from '@/lib/debug-config';
import { awaitWriteResponse } from './await-write-response';
import type { ProtocolSender } from './workspace-operations';

export interface AppsTransport {
  /** Send `request` and resolve with the first answer `isOurs` accepts. */
  request: (request: AppsRequest, isOurs: (answer: AppsAnswer) => boolean) => Promise<AppsAnswer>;
}

/**
 * Why a request did not do what it asked: the server's refusal, an answer that could not be read,
 * or no answer at all (the send failed, or the server was silent past the write timeout).
 */
export type AppsFailure = AppsRefusal | 'Malformed' | 'NoAnswer';
export type AppsResult<T> = { ok: true; value: T } | { ok: false; refusal: AppsFailure };

/** The production transport: the tab's workspace session. */
export function protocolAppsTransport(sender: ProtocolSender): AppsTransport {
  return {
    request: async (request: AppsRequest, isOurs: (answer: AppsAnswer) => boolean): Promise<AppsAnswer> => {
      let answered: AppsAnswer | null = null;
      await awaitWriteResponse('Apps', () => sender.sendProtocolRequest({ Apps: request }), (payload: unknown): boolean => {
        const answer: AppsAnswer = readAppsAnswer(payload);
        if (!isOurs(answer)) return false;
        answered = answer;
        return true;
      });
      if (answered === null) throw new Error('Apps: the server\'s answer did not fit the request');
      return answered;
    },
  };
}

/**
 * One request at a time over `inner`: the protocol has no request id and a refusal answers
 * whichever request is waiting, so two in flight together could swap refusals. Every user of a
 * tab's session (the marketplace, a page's zones, its running apps) shares the one wrapper.
 */
export function serialAppsTransport(inner: AppsTransport): AppsTransport {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    request: (request: AppsRequest, isOurs: (answer: AppsAnswer) => boolean): Promise<AppsAnswer> => {
      const run = (): Promise<AppsAnswer> => inner.request(request, isOurs);
      const next: Promise<AppsAnswer> = queue.then(run, run);
      queue = next.catch((): void => undefined);
      return next;
    },
  };
}

export type Kind = AppsAnswer['kind'];
export type Of<K extends Kind> = Extract<AppsAnswer, { kind: K }>;

/** Ask, take the answer of `kind` that `fits`, or the refusal; anything else is malformed. */
export async function ask<K extends Kind, T>(t: AppsTransport, request: AppsRequest, kind: K, fits: (a: Of<K>) => boolean, value: (a: Of<K>) => T): Promise<AppsResult<T>> {
  const answer: AppsAnswer | null = await answerTo(t, request, (a: AppsAnswer): boolean => a.kind === kind && fits(a as Of<K>));
  if (answer === null) return { ok: false, refusal: 'NoAnswer' };
  if (answer.kind === 'refused') return { ok: false, refusal: answer.refusal };
  if (answer.kind !== kind) return { ok: false, refusal: 'Malformed' };
  return { ok: true, value: value(answer as Of<K>) };
}

/** The answer that is ours (or a refusal, or unreadable), or null when none came. */
async function answerTo(t: AppsTransport, request: AppsRequest, ours: (a: AppsAnswer) => boolean): Promise<AppsAnswer | null> {
  try {
    return await t.request(request, (a: AppsAnswer): boolean => a.kind === 'refused' || a.kind === 'malformed' || ours(a));
  } catch (error: unknown) {
    debugLog('AppsOperations', 'an apps request had no answer', error);
    return null;
  }
}

const always = (): boolean => true;
const listingIsFor = (listing: AppListing, appId: string): boolean => {
  const reading: ManifestReading = readManifestBytes(Uint8Array.from(listing.manifest_bytes));
  return reading.ok && reading.manifest.id === appId;
};

export const listCatalogue = (t: AppsTransport): Promise<AppsResult<AppListing[]>> =>
  ask(t, 'ListCatalogue', 'catalogue', always, (a: Of<'catalogue'>) => a.listings);

export const getListing = (t: AppsTransport, appId: string): Promise<AppsResult<AppListing>> =>
  ask(t, { GetListing: { app_id: appId } }, 'listing', (a: Of<'listing'>) => listingIsFor(a.listing, appId), (a: Of<'listing'>) => a.listing);

/** The installs that reach the caller, which of them the caller turned off for themselves, and the caller's P2P answers. */
export interface InstallsView {
  installs: AppInstall[];
  disabledForMe: string[];
  peerForMe: PeerForMe[];
}

export const listInstalls = (t: AppsTransport): Promise<AppsResult<InstallsView>> =>
  ask(t, 'ListInstalls', 'installs', always, (a: Of<'installs'>) => ({ installs: a.installs, disabledForMe: a.disabledForMe, peerForMe: a.peerForMe }));

export interface InstallChoice {
  appId: string;
  version: string;
  /** Where the manifest comes from (listing-offer.ts `listingOffer`). */
  listing: ListingOffer;
  scope: InstallScope;
  granted: Capability[];
  /** The key the installer saw on the consent screen; the server installs only under it. */
  pinnedPublisherKey: string;
  injectRequirement: boolean;
}

export const installApp = (t: AppsTransport, c: InstallChoice): Promise<AppsResult<AppInstall>> =>
  ask(t, { Install: { app_id: c.appId, version: c.version, listing: c.listing, scope: c.scope, granted: c.granted, pinned_publisher_key: c.pinnedPublisherKey, inject_requirement: c.injectRequirement } },
    'installed', (a: Of<'installed'>) => a.install.app_id === c.appId && a.install.version === c.version, (a: Of<'installed'>) => a.install);

/** `purgeStorage` has no default: the person removing the app says whether its data goes too. */
export const uninstallApp = (t: AppsTransport, installId: string, purgeStorage: boolean): Promise<AppsResult<string>> =>
  ask(t, { Uninstall: { install_id: installId, purge_storage: purgeStorage } }, 'uninstalled', (a: Of<'uninstalled'>) => a.installId === installId, (a: Of<'uninstalled'>) => a.installId);

export const setDisabledForMe = (t: AppsTransport, installId: string, disabled: boolean): Promise<AppsResult<boolean>> =>
  ask(t, { SetDisabledForMe: { install_id: installId, disabled } }, 'disabled-for-me',
    (a: Of<'disabled-for-me'>) => a.installId === installId && a.disabled === disabled, (a: Of<'disabled-for-me'>) => a.disabled);

export type UpdateOutcome = { kind: 'updated'; install: AppInstall } | { kind: 'up-to-date' };

/** `listing` is where a newer version is looked for (listing-offer.ts `updateOffer`). */
export async function checkForUpdate(t: AppsTransport, installId: string, listing: ListingOffer): Promise<AppsResult<UpdateOutcome>> {
  const answer: AppsAnswer | null = await answerTo(t, { Update: { install_id: installId, listing } }, (a: AppsAnswer): boolean =>
    (a.kind === 'updated' && a.install.id === installId) || (a.kind === 'up-to-date' && a.installId === installId));
  if (answer === null) return { ok: false, refusal: 'NoAnswer' };
  if (answer.kind === 'updated') return { ok: true, value: { kind: 'updated', install: answer.install } };
  if (answer.kind === 'up-to-date') return { ok: true, value: { kind: 'up-to-date' } };
  return { ok: false, refusal: answer.kind === 'refused' ? answer.refusal : 'Malformed' };
}

/** `pinnedPublisherKey` is the key the consent screen showed; the server accepts only under it. */
export const consentToUpdate = (t: AppsTransport, installId: string, version: string, granted: Capability[], pinnedPublisherKey: string): Promise<AppsResult<AppInstall>> =>
  ask(t, { Consent: { install_id: installId, version, granted, pinned_publisher_key: pinnedPublisherKey } }, 'consented', (a: Of<'consented'>) => a.install.id === installId, (a: Of<'consented'>) => a.install);

export const requestInstall = (t: AppsTransport, appId: string, nodeId: string): Promise<AppsResult<null>> =>
  ask(t, { RequestInstall: { app_id: appId, node_id: nodeId } }, 'install-requested', always, (): null => null);
