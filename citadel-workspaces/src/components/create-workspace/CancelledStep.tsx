import type { JSX } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { workspaceHostFor } from '@/lib/onboarding/slug';
import { StepHeading } from './StepHeading';

export interface CancelledStepProps {
  readonly slug: string;
  /** Whether the choices made before Checkout survived the round trip. */
  readonly draftRestored: boolean;
  readonly onBackToPlans: () => void;
  readonly onStartOver: () => void;
}

/** Back from Stripe without paying. Nothing was charged; say so first. */
export function CancelledStep({ slug, draftRestored, onBackToPlans, onStartOver }: CancelledStepProps): JSX.Element {
  return (
    <div data-testid="checkout-cancelled">
      <StepHeading title="Checkout cancelled">
        Nothing was charged, and {workspaceHostFor(slug)} has not been created.
        {draftRestored ? ' Your choices are still here if you want to try again.' : ''}
      </StepHeading>
      <div className="flex flex-col-reverse gap-3 sm:flex-row justify-between">
        <Button type="button" variant="ghost" size="lg" onClick={onStartOver} className="h-11">
          Start over
        </Button>
        {draftRestored && (
          <Button type="button" size="lg" onClick={onBackToPlans} data-testid="cancelled-back-to-plans" className="h-11 gap-2">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to plans
          </Button>
        )}
      </div>
    </div>
  );
}
