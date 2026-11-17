import { useCallback, useState, type JSX } from 'react';
import { Link, useNavigate, useSearchParams, type NavigateFunction } from 'react-router-dom';
import { CreateWorkspaceLayout } from '@/components/create-workspace/CreateWorkspaceLayout';
import { NameStep } from '@/components/create-workspace/NameStep';
import { PlanStep } from '@/components/create-workspace/PlanStep';
import { ReviewStep } from '@/components/create-workspace/ReviewStep';
import { ProvisioningStep } from '@/components/create-workspace/ProvisioningStep';
import { CancelledStep } from '@/components/create-workspace/CancelledStep';
import { ClaimStep } from '@/components/create-workspace/ClaimStep';
import { StepHeading } from '@/components/create-workspace/StepHeading';
import { useAgentOptionalHere } from '@/lib/onboarding/agent-optional';
import { debugLog } from '@/lib/debug-config';
import { recordIssuedClaim, revealClaimCode, forgetIssuedClaim } from '@/lib/onboarding/claim-handoff';
import { readControlPlaneBase } from '@/lib/onboarding/control-plane-config';
import { ControlPlaneError, createControlPlane, type ControlPlane, type CreateTenantResult } from '@/lib/onboarding/control-plane-client';
import {
  FORM_STEP_LABELS,
  INITIAL_PLAN,
  clearDraft,
  couponForPlan,
  formStepNumber,
  loadDraft,
  saveDraft,
  stepFromUrl,
  type AppliedCoupon,
  type FlowDraft,
  type FlowStep,
} from '@/lib/onboarding/create-flow';
import { CouponField } from '@/components/create-workspace/CouponField';
import { isCouponRefusal, recheckCoupon, type Recheck } from '@/lib/onboarding/coupon-recheck';
import { requestFor } from '@/lib/onboarding/tenant-request';
import { deriveSlug, sanitizeSlugInput } from '@/lib/onboarding/slug';
import { useSlugAvailability, type Availability } from '@/lib/onboarding/slug-availability';
import type { PlanSelection } from '@/lib/onboarding/tiers';

export interface CreateWorkspaceFlowProps {
  readonly api: ControlPlane;
  /** Leave for Stripe Checkout. The URL has already been checked against CHECKOUT_ORIGIN. */
  readonly redirect: (checkoutUrl: string) => void;
}

/**
 * "Create new workspace": name it, choose a plan, prove you are human, create.
 *
 * Free workspaces are created on the spot. Paid ones leave for Stripe Checkout
 * and come back here, to a screen that waits for the workspace to exist. Both
 * end at the claim screen, which hands over the claim code once and then sends
 * the visitor into the ordinary join wizard with the new address filled in.
 */
export function CreateWorkspaceFlow({ api, redirect }: CreateWorkspaceFlowProps): JSX.Element {
  useAgentOptionalHere();
  const navigate: NavigateFunction = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [initial] = useState<{ step: FlowStep; draft: FlowDraft | undefined }>(() => {
    const step: FlowStep = stepFromUrl(searchParams);
    return { step, draft: step.step === 'cancelled' ? loadDraft(step.slug) : undefined };
  });
  const [flow, setFlow] = useState<FlowStep>(initial.step);
  const [displayName, setDisplayName] = useState<string>(initial.draft?.displayName ?? '');
  const [slug, setSlug] = useState<string>(initial.draft?.slug ?? '');
  const [slugEdited, setSlugEdited] = useState<boolean>(initial.draft !== undefined);
  const [plan, setPlan] = useState<PlanSelection>(initial.draft?.plan ?? INITIAL_PLAN);
  const [coupon, setCoupon] = useState<AppliedCoupon | undefined>(initial.draft?.coupon);
  const availability: Availability = useSlugAvailability(api, flow.step === 'name' ? slug : '');

  const toClaim: (workspaceHost: string, claimCode: string | undefined) => void = useCallback((workspaceHost: string, claimCode: string | undefined): void => {
    recordIssuedClaim(workspaceHost, claimCode);
    clearDraft();
    setSearchParams({}, { replace: true });
    setFlow({ step: 'claim', workspaceHost, claimCode: revealClaimCode() });
  }, [setSearchParams]);

  const startOver = (): void => {
    clearDraft();
    forgetIssuedClaim();
    setSearchParams({}, { replace: true });
    setDisplayName('');
    setSlug('');
    setSlugEdited(false);
    setPlan(INITIAL_PLAN);
    setCoupon(undefined);
    setFlow({ step: 'name' });
  };

  const submit = async (turnstileToken: string): Promise<string | undefined> => {
    const draft: FlowDraft = { displayName, slug, plan, reservationToken: initial.draft?.reservationToken, coupon };
    try {
      const result: CreateTenantResult = await api.createTenant(requestFor(draft, turnstileToken));
      if (result.kind === 'created') {
        toClaim(result.workspaceHost, result.claimCode);
      } else {
        const kept: boolean = saveDraft({ ...draft, reservationToken: result.reservationToken });
        if (!kept) debugLog('CreateWorkspace', 'Draft not kept across Checkout: session storage refused the write.');
        redirect(result.checkoutUrl);
      }
      return undefined;
    } catch (error: unknown) {
      if (draft.coupon && isCouponRefusal(error)) {
        setCoupon(undefined);
        const recheck: Recheck = await recheckCoupon(api, draft.coupon.code, plan);
        setCoupon(recheck.coupon);
        return recheck.message;
      }
      return error instanceof ControlPlaneError ? error.message : 'Something went wrong. Please try again.';
    }
  };

  const content = (): JSX.Element => {
    switch (flow.step) {
      case 'name':
        return (
          <NameStep
            displayName={displayName}
            slug={slug}
            availability={availability}
            onDisplayNameChange={(value: string) => {
              setDisplayName(value);
              if (!slugEdited) setSlug(deriveSlug(value));
            }}
            onSlugChange={(value: string) => {
              setSlugEdited(true);
              setSlug(sanitizeSlugInput(value));
            }}
            onContinue={() => setFlow({ step: 'plan' })}
          />
        );
      case 'plan':
        return (
          <PlanStep
            plan={plan}
            onChange={(next: PlanSelection) => {
              setCoupon((held: AppliedCoupon | undefined) => couponForPlan(held, plan, next));
              setPlan(next);
            }}
            coupon={<CouponField port={api} plan={plan} applied={coupon} onApplied={setCoupon} />}
            onBack={() => setFlow({ step: 'name' })}
            onContinue={() => setFlow({ step: 'review' })}
          />
        );
      case 'review':
        return (
          <ReviewStep
            displayName={displayName.trim()}
            slug={slug}
            plan={plan}
            coupon={coupon}
            onBack={() => setFlow({ step: 'plan' })}
            onSubmit={submit}
          />
        );
      case 'provisioning':
        return (
          <ProvisioningStep api={api} slug={flow.slug} sessionId={flow.sessionId} onActive={toClaim} onStartOver={startOver} />
        );
      case 'cancelled':
        return (
          <CancelledStep
            slug={flow.slug}
            draftRestored={initial.draft !== undefined}
            onBackToPlans={() => {
              setSearchParams({}, { replace: true });
              setFlow({ step: 'plan' });
            }}
            onStartOver={startOver}
          />
        );
      case 'claim':
        return (
          <ClaimStep
            workspaceHost={flow.workspaceHost}
            claimCode={flow.claimCode}
            onOpenWorkspace={() => navigate('/?join=1')}
          />
        );
    }
  };

  const stepNumber: number | undefined =
    flow.step === 'name' || flow.step === 'plan' || flow.step === 'review' ? formStepNumber(flow.step) : undefined;

  return (
    <CreateWorkspaceLayout stepNumber={stepNumber} stepLabels={FORM_STEP_LABELS}>
      <div key={flow.step}>{content()}</div>
    </CreateWorkspaceLayout>
  );
}

/** A deployment with no control plane: say so, and point at the wizard, which still works. */
function CreateUnavailable(): JSX.Element {
  return (
    <CreateWorkspaceLayout stepNumber={undefined} stepLabels={FORM_STEP_LABELS}>
      <div data-testid="create-unavailable">
        <StepHeading title="Workspaces are not created here">
          This Citadel site does not host workspaces. If you run your own Citadel server, connect to it with its
          address and master password instead.
        </StepHeading>
        <Link to="/?join=1" className="inline-flex min-h-[24px] items-center text-sm text-foreground underline underline-offset-4">
          Connect to a server
        </Link>
      </div>
    </CreateWorkspaceLayout>
  );
}

/** The `/create` route: the flow, against the control plane this deployment publishes. */
export default function CreateWorkspace(): JSX.Element {
  const [api] = useState<ControlPlane | undefined>(() => {
    const base: string | undefined = readControlPlaneBase(document);
    return base === undefined
      ? undefined
      : createControlPlane((input: string, init?: RequestInit): Promise<Response> => fetch(input, init), base);
  });
  if (api === undefined) return <CreateUnavailable />;
  return <CreateWorkspaceFlow api={api} redirect={(url: string) => window.location.assign(url)} />;
}
