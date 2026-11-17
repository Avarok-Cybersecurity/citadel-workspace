import { useState, type JSX } from 'react';
import { AlertCircle, ArrowLeft, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { workspaceHostFor } from '@/lib/onboarding/slug';
import { STORAGE_ADDON, formatUsd, isPaid, quote, tierById, type PlanSelection, type Quote } from '@/lib/onboarding/tiers';
import { INTERVAL_NAME } from './PlanStep';
import { StepHeading } from './StepHeading';
import { TurnstileWidget } from './TurnstileWidget';
import { TURNSTILE_ACTION, TURNSTILE_SITEKEY } from '@/lib/onboarding/turnstile';
import { TermsAcceptanceModal } from '@/components/terms/TermsAcceptanceModal';
import { CUSTOMER_TERMS_DOCUMENT, PLATFORM_TERMS_DOCUMENT } from '@/lib/terms/legal-documents';
import { COVERED_BY_CODE, couponSummary, trialCopy } from '@/lib/onboarding/coupon-copy';
import { applyCoupon, type PricedQuote } from '@/lib/onboarding/coupon-quote';
import type { AppliedCoupon } from '@/lib/onboarding/create-flow';

export interface ReviewStepProps {
  readonly displayName: string;
  readonly slug: string;
  readonly plan: PlanSelection;
  /** The applied code, if any; only ever held on a paid tier. */
  readonly coupon: AppliedCoupon | undefined;
  readonly onBack: () => void;
  /**
   * Spend the token. Resolves to an error message when the request was refused,
   * or `undefined` when it succeeded (and the page has moved on).
   */
  readonly onSubmit: (turnstileToken: string) => Promise<string | undefined>;
}

interface RowProps { readonly label: string; readonly value: string; readonly testId?: string; readonly words?: true }

/** `words`: the value is a sentence, wrapped between words; otherwise it is an address or a number, broken anywhere. */
function Row({ label, value, testId, words }: RowProps): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row justify-between sm:gap-4">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className={cn('text-sm font-medium text-foreground', words ? 'break-words sm:text-right' : 'break-all')} data-testid={testId}>{value}</dd>
    </div>
  );
}

/** Step 3: check everything, prove you are a person, and create. */
function submitLabel(paid: boolean, priced: PricedQuote): string {
  if (!paid || priced.covered) return 'Create workspace';
  return priced.trialDays > 0 ? 'Start free trial' : 'Continue to payment';
}

export function ReviewStep({ displayName, slug, plan, coupon, onBack, onSubmit }: ReviewStepProps): JSX.Element {
  const [token, setToken] = useState<string | undefined>(undefined);
  const [resetSignal, setResetSignal] = useState<number>(0);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [asking, setAsking] = useState<boolean>(false);
  const paid: boolean = isPaid(plan.tier);
  const q: Quote = quote(plan);
  const priced: PricedQuote = applyCoupon(q, paid && coupon ? coupon.preview : null, plan.interval);
  const per: string = INTERVAL_NAME[plan.interval];
  const charges: boolean = paid && !priced.covered && priced.trialDays === 0;

  const submit = async (): Promise<void> => {
    if (busy) return;
    if (!token) {
      setError('The human check expired while you were reading. Wait for it to refresh, then press the button again.');
      return;
    }
    // One use only: siteverify rejects a token it has seen, so it is dropped
    // here whatever the outcome, and a refusal asks the widget for a new one.
    const spent: string = token;
    setToken(undefined);
    setBusy(true);
    setError(undefined);
    const refusal: string | undefined = await onSubmit(spent);
    if (refusal !== undefined) {
      setError(refusal);
      setBusy(false);
      setResetSignal((n) => n + 1);
    }
  };

  return (
    <div>
      <StepHeading title="Review and create">
        One last check. Confirm you are human, and we will set up your workspace.
      </StepHeading>

      <dl className="divide-y divide-border rounded-xl border border-border bg-background px-4">
        <Row label="Workspace" value={displayName} testId="review-name" />
        <Row label="Address" value={workspaceHostFor(slug)} testId="review-host" />
        <Row label="Plan" value={paid ? `${tierById(plan.tier).name}, billed per ${per}` : 'Free'} testId="review-plan" />
        {paid && <Row label="Seats" value={String(plan.seats)} />}
        {paid && plan.storageBlocks > 0 && <Row label="Extra storage" value={`${plan.storageBlocks * STORAGE_ADDON.gbPerBlock} GB`} />}
        {paid && q.sharedLinks > 0 && (
          <Row label="Extra secure links" value={`${q.sharedLinks.toLocaleString('en-US')}, shared by the workspace`} testId="review-link-packs" />
        )}
        {paid && plan.chatDocumentPacks > 0 && (
          <Row label="Chat documents" value={`${q.chatDocuments.toLocaleString('en-US')} in all, with ${plan.chatDocumentPacks} extra ${plan.chatDocumentPacks === 1 ? 'pack' : 'packs'}`} testId="review-chat-document-packs" />
        )}
        {paid && coupon && <Row label="Code" value={`${coupon.code}: ${couponSummary(coupon.preview)}`} testId="review-coupon" words />}
        <Row label="Total" value={!paid ? 'Free' : priced.covered ? COVERED_BY_CODE : `${formatUsd(q.totalCents)} / ${per}`} testId="review-total" />
        {paid && !priced.covered && <Row label="Due today" value={formatUsd(priced.dueTodayCents)} testId="review-due-today" />}
      </dl>
      {priced.trialDays > 0 && <p className="mt-3 text-sm text-muted-foreground" data-testid="review-trial">{trialCopy(priced.trialDays)}</p>}

      <div className="mt-6">
        <p className="mb-2 text-sm font-medium text-foreground">Verify you are human</p>
        <TurnstileWidget sitekey={TURNSTILE_SITEKEY} action={TURNSTILE_ACTION} cData={null} onToken={setToken} resetSignal={resetSignal} />
      </div>

      {error && (
        <div role="alert" data-testid="create-error" className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-emphasis">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row justify-between">
        <Button type="button" variant="ghost" size="lg" onClick={onBack} disabled={busy} className="h-11 gap-2">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Button>
        <Button
          type="button"
          size="lg"
          disabled={!token || busy}
          onClick={() => setAsking(true)}
          data-testid="create-submit"
          className="h-11 gap-2"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : charges && <Lock className="h-4 w-4" aria-hidden="true" />}
          {busy ? 'Working…' : submitLabel(paid, priced)}
        </Button>
      </div>

      {asking && (
        <TermsAcceptanceModal
          title="Customer Terms and Terms of Use"
          documents={[CUSTOMER_TERMS_DOCUMENT, PLATFORM_TERMS_DOCUMENT]}
          agreement="I agree to the Customer Terms and the Terms of Use, on behalf of myself or the organization I represent."
          onCancel={() => setAsking(false)}
          onAccept={() => { setAsking(false); void submit(); }}
        />
      )}
    </div>
  );
}
