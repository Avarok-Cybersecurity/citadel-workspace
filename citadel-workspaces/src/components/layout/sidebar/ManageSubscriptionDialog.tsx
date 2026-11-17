import { useState, type FormEvent } from 'react';
import { CreditCard, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ControlPlane } from '@/lib/onboarding/control-plane-client';
import { describePortalRefusal, type PortalRefusal, type PortalTab } from '@/lib/onboarding/billing-portal';

interface ManageSubscriptionDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly slug: string;
  readonly api: ControlPlane;
  /** Opens an empty tab, or returns null when the browser refused one. */
  readonly openTab: () => PortalTab | null;
}

type Outcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'opening' }
  | { readonly kind: 'opened'; readonly portalUrl: string; readonly blocked: boolean }
  | { readonly kind: 'refused'; readonly refusal: PortalRefusal };

const IDLE: Outcome = { kind: 'idle' };

/**
 * "Plan & billing": the owner proves ownership with the workspace's claim code,
 * and the Stripe Billing Portal opens in a new tab.
 *
 * The code lives only in this component's state, in a password field, and is
 * cleared the moment the request settles, whatever the answer. It is never
 * logged and never stored.
 */
export function ManageSubscriptionDialog({ open, onOpenChange, slug, api, openTab }: ManageSubscriptionDialogProps): JSX.Element {
  const [claimCode, setClaimCode] = useState<string>('');
  const [outcome, setOutcome] = useState<Outcome>(IDLE);

  const close = (next: boolean): void => {
    if (!next) {
      setClaimCode('');
      setOutcome(IDLE);
    }
    onOpenChange(next);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const presented: string = claimCode.trim();
    if (presented.length === 0 || outcome.kind === 'opening') return;
    // Opened while the click still counts as the user's, so it is not blocked as a popup.
    const tab: PortalTab | null = openTab();
    setOutcome({ kind: 'opening' });
    try {
      const portalUrl: string = await api.openPortal(slug, presented);
      if (tab) tab.navigate(portalUrl);
      setOutcome({ kind: 'opened', portalUrl, blocked: tab === null });
    } catch (error: unknown) {
      tab?.close();
      setOutcome({ kind: 'refused', refusal: describePortalRefusal(error) });
    } finally {
      setClaimCode('');
    }
  };

  const finalRefusal: boolean = outcome.kind === 'refused' && !outcome.refusal.retry;
  const busy: boolean = outcome.kind === 'opening';

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="bg-surface">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <CreditCard className="h-5 w-5" aria-hidden="true" />
            Plan & billing
          </DialogTitle>
          <DialogDescription>
            Change or cancel this workspace&apos;s plan in the Stripe billing portal. Enter the claim code you
            were given when the workspace was created to prove you own it.
          </DialogDescription>
        </DialogHeader>

        {outcome.kind === 'refused' && (
          <p role="alert" className="text-sm text-destructive">{outcome.refusal.message}</p>
        )}

        {outcome.kind === 'opened' && (
          <p role="status" className="text-sm text-foreground">
            {outcome.blocked ? (
              <a href={outcome.portalUrl} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-1">
                Open billing portal <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : 'The billing portal opened in a new tab.'}
          </p>
        )}

        {!finalRefusal && outcome.kind !== 'opened' && (
          <form onSubmit={(e: FormEvent<HTMLFormElement>): void => { void submit(e); }} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="billing-claim-code">Claim code</Label>
              <Input
                id="billing-claim-code"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={claimCode}
                onChange={(e: React.ChangeEvent<HTMLInputElement>): void => setClaimCode(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy || claimCode.trim().length === 0} className="gap-2">
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Manage subscription
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
