/**
 * Why a zone's running app is closed. Pure. Whether the install is gone or no longer reaches this
 * person is read from the install list, never from the view the zone shows next: with another
 * install of the same app covering the page, the next view is that install's (or its disabled
 * placeholder), so an uninstall read from it was an unmount or a revoked access. The list says:
 * the running install absent is `uninstall`; present but no longer covering this person,
 * disabled for them or suspended is `access_revoked`. Otherwise the next view decides between
 * another release (`version_update`) and the zone simply going (`unmount`).
 *
 * AppZone.tsx records the next view and facts in a layout effect of the parent, which React runs
 * in the commit's layout phase, before the passive-effect cleanup that closes the app, so the
 * close carries the reason of the commit that removed or replaced it. A zone whose page goes away
 * keeps the last ones: `unmount`.
 */
import type { AppInstall } from 'citadel-workspace-client-ts';
import type { CloseReason } from '@/lib/citadel-apps/sdk/generated/CloseReason';
import { covers } from '@/lib/citadel-apps/install-covers';
import type { ZoneFacts, ZoneView } from './zone-state';

/** What the zone shows next, and what it was decided from. */
export interface ZoneNext {
  readonly view: ZoneView;
  readonly facts: ZoneFacts;
}

function fromInstalls(running: AppInstall, f: ZoneFacts): CloseReason | null {
  if (typeof f.installs === 'string' || f.me === null) return null;
  const now: AppInstall | undefined = f.installs.find((i: AppInstall) => i.id === running.id);
  if (now === undefined) return 'uninstall';
  const reached: boolean = covers(now.scope, f.me, f.nodeId, f.ancestors) && !f.disabledForMe.has(now.id);
  const suspended: boolean = typeof now.state === 'object' && 'Suspended' in now.state;
  return reached && !suspended ? null : 'access_revoked';
}

function fromView(running: AppInstall, next: ZoneView): CloseReason {
  switch (next.kind) {
    case 'ready': return next.install.id === running.id && next.install.manifest_sha256 !== running.manifest_sha256 ? 'version_update' : 'unmount';
    case 'loading': case 'not-available': return 'unmount';
    case 'install': case 'ask-admin': return 'uninstall';
    case 'disabled': case 'suspended': case 'needs-answer': return 'access_revoked';
    // A release that no longer runs here replaced the one that did.
    case 'needs-consent': case 'outdated': case 'wrong-surface': return 'version_update';
  }
}

/** The reason to close the app that ran `running`, given what the zone shows next and why. */
export function closeReasonFor(running: AppInstall, next: ZoneNext): CloseReason {
  return fromInstalls(running, next.facts) ?? fromView(running, next.view);
}
