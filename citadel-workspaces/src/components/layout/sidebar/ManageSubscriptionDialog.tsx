import { useState, type FormEvent } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import type { BillingPortalAnswer } from 'citadel-workspace-client-ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ControlPlane } from '@/lib/onboarding/control-plane-client';
import {
  describePortalRefusal,
  sessionPortalOutcome,
  type PortalRefusal,
  type PortalTab,
  type SessionPortalOutcome,
} from '@/lib/onboarding/billing-portal';

interface ManageSubscriptionDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly slug: string;
  readonly api: ControlPlane;
  /** Opens an empty tab, or returns null when the browser refused one. */
  readonly openTab: () => PortalTab | null;
  /**
   * `OpenBillingPortal` over this member's session. The server decides from the session's own
   * account; it rejects when the server refuses (no permission here, or no billing at all).
   */
  readonly openSessionPortal: () => Promise<BillingPortalAnswer>;
}

type Outcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'opening' }
  | { readonly kind: 'opened'; readonly portalUrl: string; readonly blocked: boolean }
  | { readonly kind: 'refused'; readonly refusal: PortalRefusal };

/** How the portal is asked for: the member's session first, the claim code when that is refused. */
type Path = 'session' | 'claim';

const IDLE: Outcome = { kind: 'idle' };
const ANSWER: string = 'min-h-[44px]';

/**
 * "Plan & billing": the Stripe Billing Portal, opened in a new tab.
 *
 * Asked first over the member's session, so someone the server knows may manage the plan never
 * needs the claim code. When the server refuses that (it decides, from the session's account),
 * the owner proves ownership with the workspace's claim code instead. The code lives only in this
 * component's state, in a password field, and is cleared the moment the request settles, whatever
 * the answer. It is never logged and never stored.
 *
 * Styled as the other settings dialogs are (WorkspaceSettingsDialog): the dialog's own surface,
 * the shared header and footer, and 44px answers.
 */
export function ManageSubscriptionDialog({ open, onOpenChange, slug, api, openTab, openSessionPortal }: ManageSubscriptionDialogProps): JSX.Element {
  const [path, setPath] = useState<Path>('session');
  const [claimCode, setClaimCode] = useState<string>('');
  const [outcome, setOutcome] = useState<Outcome>(IDLE);

  const close = (next: boolean): void => {
    if (!next) {
      setPath('session');
      setClaimCode('');
      setOutcome(IDLE);
    }
    onOpenChange(next);
  };

  /** Opens the tab while the click still counts as the user's, so it is not blocked as a popup. */
  const settle = async (ask: () => Promise<SessionPortalOutcome>): Promise<void> => {
    const tab: PortalTab | null = openTab();
    setOutcome({ kind: 'opening' });
    try {
      const answer: SessionPortalOutcome = await ask();
      if (answer.kind === 'opened') {
        if (tab) tab.navigate(answer.portalUrl);
        setOutcome({ kind: 'opened', portalUrl: answer.portalUrl, blocked: tab === null });
      } else {
        tab?.close();
        setOutcome({ kind: 'refused', refusal: answer.refusal });
      }
    } catch (error: unknown) {
      tab?.close();
      throw error;
    }
  };

  const viaSession = async (): Promise<void> => {
    if (outcome.kind === 'opening') return;
    try {
      await settle(async (): Promise<SessionPortalOutcome> => sessionPortalOutcome(await openSessionPortal()));
    } catch {
      // Refused for this session (or not offered by this server): the claim code still works.
      setPath('claim');
      setOutcome(IDLE);
    }
  };

  const viaClaim = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const presented: string = claimCode.trim();
    if (presented.length === 0 || outcome.kind === 'opening') return;
    try {
      await settle(async (): Promise<SessionPortalOutcome> => ({ kind: 'opened', portalUrl: await api.openPortal(slug, presented) }));
    } catch (error: unknown) {
      setOutcome({ kind: 'refused', refusal: describePortalRefusal(error) });
    } finally {
      setClaimCode('');
    }
  };

  const busy: boolean = outcome.kind === 'opening';
  const finished: boolean = outcome.kind === 'opened' || (outcome.kind === 'refused' && !outcome.refusal.retry);
  const spinner: JSX.Element | null = busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null;
  const dismiss: JSX.Element = (
    <Button type="button" variant="outline" className={ANSWER} onClick={() => close(false)}>
      {finished ? 'Done' : 'Cancel'}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg" data-testid="plan-and-billing-dialog">
        <DialogHeader>
          <DialogTitle>Plan & billing</DialogTitle>
          <DialogDescription>
            Change or cancel this workspace&apos;s plan in the Stripe billing portal, which opens in a new tab.
            {path === 'claim' && ' Enter the claim code you were given when the workspace was created to prove you own it.'}
          </DialogDescription>
        </DialogHeader>

        {outcome.kind === 'refused' && (
          <p role="alert" className="text-sm text-destructive-emphasis">{outcome.refusal.message}</p>
        )}

        {outcome.kind === 'opened' && (
          <p role="status" className="text-sm text-foreground">
            {outcome.blocked ? (
              <a href={outcome.portalUrl} target="_blank" rel="noopener noreferrer" className={`${ANSWER} underline inline-flex items-center gap-1`}>
                Open billing portal <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : 'The billing portal opened in a new tab.'}
          </p>
        )}

        {finished && <DialogFooter>{dismiss}</DialogFooter>}

        {!finished && path === 'session' && (
          <DialogFooter>
            {dismiss}
            <Button type="button" className={`${ANSWER} gap-2`} disabled={busy} onClick={() => { const _: Promise<void> = viaSession(); }}>
              {spinner}
              Manage subscription
            </Button>
          </DialogFooter>
        )}

        {!finished && path === 'claim' && (
          <form onSubmit={(e: FormEvent<HTMLFormElement>): void => { const _: Promise<void> = viaClaim(e); }} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="billing-claim-code">Claim code</Label>
              <Input
                id="billing-claim-code"
                type="password"
                autoComplete="off"
                spellCheck={false}
                className={ANSWER}
                value={claimCode}
                onChange={(e: React.ChangeEvent<HTMLInputElement>): void => setClaimCode(e.target.value)}
                disabled={busy}
              />
            </div>
            <DialogFooter>
              {dismiss}
              <Button type="submit" disabled={busy || claimCode.trim().length === 0} className={`${ANSWER} gap-2`}>
                {spinner}
                Manage subscription
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
