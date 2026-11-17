import { useId, useState, type FormEvent, type JSX } from 'react';
import { Check, ChevronDown, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { COUPON_CODE_MAX_LENGTH } from '@/lib/onboarding/coupon-code';
import { COUPON_REFUSAL_COPY, describeCoupon } from '@/lib/onboarding/coupon-copy';
import { applyCoupon, type PricedQuote } from '@/lib/onboarding/coupon-quote';
import type { AppliedCoupon } from '@/lib/onboarding/create-flow';
import { formatUsd, isPaid, quote, type PlanSelection } from '@/lib/onboarding/tiers';
import { useCouponField, type CouponFieldModel, type CouponFieldStatus, type CouponPort } from './use-coupon-field';

export interface CouponFieldProps {
  readonly port: CouponPort;
  readonly plan: PlanSelection;
  readonly applied: AppliedCoupon | undefined;
  readonly onApplied: (coupon: AppliedCoupon | undefined) => void;
}

function StatusLine({ status, plan }: { readonly status: CouponFieldStatus; readonly plan: PlanSelection }): JSX.Element | null {
  switch (status.state) {
    case 'idle':
      return null;
    case 'checking':
      return (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Checking the code…
        </span>
      );
    case 'applied': {
      const priced: PricedQuote = applyCoupon(quote(plan), status.coupon.preview, plan.interval);
      return (
        <span className="flex flex-col gap-0.5 text-foreground">
          <span className="inline-flex items-start gap-1.5">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
            <span data-testid="coupon-preview-line">{describeCoupon(status.coupon.preview)}</span>
          </span>
          {!priced.covered && <span className="pl-5 text-muted-foreground" data-testid="coupon-due-today">Due today: {formatUsd(priced.dueTodayCents)}</span>}
        </span>
      );
    }
    case 'unavailable':
    case 'rate-limited':
    case 'offline':
      return (
        <span className="inline-flex items-start gap-1.5 text-destructive-emphasis">
          <X className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {COUPON_REFUSAL_COPY[status.state]}
        </span>
      );
  }
}

/**
 * "Have a code?": a disclosure on the plan step, for paid tiers only (the free
 * tier takes no coupon). The control plane decides what a code does; this
 * shows its answer for the plan on screen.
 */
export function CouponField({ port, plan, applied, onApplied }: CouponFieldProps): JSX.Element | null {
  const field: CouponFieldModel = useCouponField(port, plan, applied, onApplied);
  const [open, setOpen] = useState<boolean>(field.code.length > 0);
  const id: string = useId();
  if (!isPaid(plan.tier)) return null;

  const checking: boolean = field.status.state === 'checking';
  const isApplied: boolean = field.status.state === 'applied';
  const refused: boolean = field.status.state === 'unavailable' || field.status.state === 'rate-limited' || field.status.state === 'offline';
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    field.apply();
  };

  return (
    <div className="mt-4" data-testid="coupon-field" data-state={field.status.state}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((o: boolean) => !o)}
        data-testid="coupon-toggle"
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Have a code?
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      <form id={`${id}-panel`} hidden={!open} onSubmit={submit} noValidate className="mt-2 space-y-2">
        <label htmlFor={`${id}-code`} className="block text-sm font-medium text-foreground">Code</label>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Input
            id={`${id}-code`}
            data-testid="coupon-input"
            value={field.code}
            maxLength={COUPON_CODE_MAX_LENGTH}
            spellCheck={false}
            autoCapitalize="characters"
            autoComplete="off"
            aria-describedby={`${id}-status`}
            aria-invalid={refused}
            onChange={(e) => field.setCode(e.target.value)}
            className="h-[44px] min-w-0 flex-1 basis-40 font-mono uppercase"
          />
          {isApplied ? (
            <Button type="button" variant="outline" onClick={field.remove} data-testid="coupon-remove" className="h-[44px] shrink-0">
              Remove
            </Button>
          ) : (
            <Button type="submit" variant="outline" disabled={field.code.length === 0 || checking} data-testid="coupon-apply" className="h-[44px] shrink-0">
              Apply
            </Button>
          )}
        </div>
        <p id={`${id}-status`} role="status" aria-live="polite" data-testid="coupon-status" className="min-h-6 text-sm">
          <StatusLine status={field.status} plan={plan} />
        </p>
      </form>
    </div>
  );
}
