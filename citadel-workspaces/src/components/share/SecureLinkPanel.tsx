/**
 * The Secure half of the share dialog: who, how long, how many are left, and Create; then the
 * link, once. At the limit, Create gives way to the way to free one up.
 */
import { Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { bookingIncomplete, grantsOf } from '@/lib/share/grant-draft';
import { LIMIT_COPY } from '@/lib/share/link-lifetime';
import type { ShareTarget } from '@/lib/share/share-target';
import { GrantBuilder, type RoleOption } from './GrantBuilder';
import { LifetimeSelect } from './LifetimeSelect';
import { LinkField } from './LinkField';
import { QuotaMeter } from './QuotaMeter';
import type { ShareLinkFlow } from './use-share-link-flow';

export const SECURE_COPY: { shownOnce: string; oneTime: string; oneTimeDetail: string; oneTimeGuests: string; noGrant: string; guestCount: string; create: string } = {
  shownOnce: 'Shown once — copy it now. Only its fingerprint is kept, so it cannot be shown again; regenerate it from Security settings if you lose it.',
  oneTime: 'One-time',
  oneTimeDetail: 'Stops working after the first person it admits opens it.',
  oneTimeGuests: 'A link with guests cannot be one-time: their access lasts as long as the link.',
  noGrant: 'Choose at least one person or group.',
  guestCount: 'Say how many guests it lets in.',
  create: 'Create secure link',
};

interface SecureLinkPanelProps {
  flow: ShareLinkFlow;
  target: ShareTarget;
  members: readonly string[];
  roles: readonly RoleOption[];
  /** Whether the reader may manage the workspace's subscription, to say where packs are bought. */
  isAdmin: boolean;
  onManageLinks: () => void;
}

/** What the live region says, so a screen reader hears each step. */
function statusOf(flow: ShareLinkFlow): string {
  switch (flow.phase.kind) {
    case 'creating': return 'Creating the secure link…';
    case 'created': return 'Secure link created. It is shown once; copy it now.';
    case 'limit-reached': return LIMIT_COPY.reached;
    case 'failed': return `The link was not created: ${flow.phase.message}`;
    case 'editing': return '';
  }
}

/** One live region for every phase: one created with its content is announced unreliably. */
export function SecureLinkPanel(props: SecureLinkPanelProps): JSX.Element {
  return (
    <div className="min-w-0">
      <SecureLinkBody {...props} />
      <p role="status" aria-live="polite" className="sr-only" data-testid="share-status">{statusOf(props.flow)}</p>
    </div>
  );
}

function SecureLinkBody({ flow, target, members, roles, isAdmin, onManageLinks }: SecureLinkPanelProps): JSX.Element {
  const { phase, quota } = flow;
  const busy: boolean = phase.kind === 'creating';
  const empty: boolean = grantsOf(flow.draft).length === 0;
  const guestsUnset: boolean = bookingIncomplete(flow.draft);

  if (phase.kind === 'created') {
    return (
      <div className="space-y-2" data-testid="share-secure-created">
        <LinkField url={phase.url} label={`Secure link to ${target.label}`} testId="share-secure-link" />
        <p className="flex items-start gap-1.5 text-xs text-warning-emphasis" data-testid="share-shown-once">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{SECURE_COPY.shownOnce}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="share-secure-panel">
      <GrantBuilder draft={flow.draft} onChange={flow.setDraft} members={members} roles={roles} target={target} disabled={busy} />
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="space-y-1">
          <Label htmlFor="share-expires" className="text-sm font-medium">Expires after</Label>
          <LifetimeSelect id="share-expires" label="Expires after" value={flow.preset} onChange={flow.setPreset} disabled={busy} testId="share-expires" />
        </div>
        <div className="flex min-h-9 items-center gap-2">
          <Switch id="share-one-time" checked={flow.oneTime} onCheckedChange={flow.setOneTime} disabled={busy || !flow.oneTimeAllowed} aria-describedby="share-one-time-detail" data-testid="share-one-time" />
          <Label htmlFor="share-one-time" className="text-sm font-medium">{SECURE_COPY.oneTime}</Label>
        </div>
      </div>
      <p id="share-one-time-detail" className="-mt-2 text-xs text-muted-foreground">{flow.oneTimeAllowed ? SECURE_COPY.oneTimeDetail : SECURE_COPY.oneTimeGuests}</p>

      {quota.kind === 'known' && <QuotaMeter quota={quota.quota} testId="share-quota" />}
      {quota.kind === 'unknown' && <p className="text-xs text-muted-foreground" data-testid="share-quota-unknown">{`How many links you have left could not be read: ${quota.message}`}</p>}

      {phase.kind === 'limit-reached' ? (
        <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3" data-testid="share-limit-reached">
          <p className="text-sm">{LIMIT_COPY.reached}</p>
          {isAdmin && <p className="text-xs text-muted-foreground">{LIMIT_COPY.admins}</p>}
          <Button type="button" variant="outline" size="sm" onClick={onManageLinks} data-testid="share-manage-links">{LIMIT_COPY.manage}</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {phase.kind === 'failed' && <p role="alert" className="text-xs text-destructive-emphasis" data-testid="share-create-failed">{statusOf(flow)}</p>}
          {guestsUnset ? <p className="text-xs text-muted-foreground">{SECURE_COPY.guestCount}</p>
            : empty && <p className="text-xs text-muted-foreground">{SECURE_COPY.noGrant}</p>}
          <Button type="button" className="w-full sm:w-auto" disabled={busy || empty || guestsUnset || quota.kind === 'loading'} onClick={() => void flow.create()} data-testid="share-create-secure">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{SECURE_COPY.create}
          </Button>
        </div>
      )}
    </div>
  );
}
