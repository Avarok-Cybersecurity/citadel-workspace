/**
 * The "Have a code?" field's state, and the one place it asks the control plane.
 *
 * The parent owns the applied coupon (it travels in the draft and the create
 * request); this owns the typed text and what the last question answered. When
 * the plan's tier, interval or seats change the parent drops the coupon
 * (create-flow.ts `couponForPlan`), and this asks about the same code again,
 * debounced, so the price shown is always an answer for the plan on screen.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { ControlPlane } from '@/lib/onboarding/control-plane-client';
import { isCouponCode, normaliseCode } from '@/lib/onboarding/coupon-code';
import type { CouponPreviewAnswer, CouponPreviewRequest, CouponRefusal } from '@/lib/onboarding/coupon-preview';
import type { AppliedCoupon } from '@/lib/onboarding/create-flow';
import { previewRequestFor } from '@/lib/onboarding/tenant-request';
import type { PlanSelection } from '@/lib/onboarding/tiers';

export type CouponPort = Pick<ControlPlane, 'previewCoupon'>;

export type CouponFieldStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'checking' }
  | { readonly state: 'applied'; readonly coupon: AppliedCoupon }
  | { readonly state: CouponRefusal };

export interface CouponFieldModel {
  readonly code: string;
  readonly status: CouponFieldStatus;
  readonly setCode: (raw: string) => void;
  readonly apply: () => void;
  readonly remove: () => void;
}

/** A plan change settles before the code is asked about again: a seat stepper is pressed in bursts. */
export const COUPON_RECHECK_DEBOUNCE_MS: number = 400;

function planKey(plan: PlanSelection): string {
  return `${plan.tier}|${plan.interval}|${plan.seats}`;
}

export function useCouponField(
  port: CouponPort,
  plan: PlanSelection,
  applied: AppliedCoupon | undefined,
  onApplied: (coupon: AppliedCoupon | undefined) => void,
): CouponFieldModel {
  const [code, setCodeText] = useState<string>(applied?.code ?? '');
  const [status, setStatus] = useState<CouponFieldStatus>(applied ? { state: 'applied', coupon: applied } : { state: 'idle' });
  /** The code the visitor asked to apply and has not withdrawn; re-asked about when the plan changes. */
  const wanted: MutableRefObject<string | undefined> = useRef<string | undefined>(applied?.code);
  const inflight: MutableRefObject<AbortController | undefined> = useRef<AbortController | undefined>(undefined);
  const latest: MutableRefObject<{ plan: PlanSelection; onApplied: (c: AppliedCoupon | undefined) => void }> =
    useRef({ plan, onApplied });
  latest.current = { plan, onApplied };

  const ask: (candidate: string) => void = useCallback((candidate: string): void => {
    inflight.current?.abort();
    inflight.current = undefined;
    if (!isCouponCode(candidate)) {
      // Not a shape any code has: refused without spending an attempt.
      wanted.current = undefined;
      setStatus({ state: 'unavailable' });
      return;
    }
    const request: CouponPreviewRequest | undefined = previewRequestFor(candidate, latest.current.plan);
    if (request === undefined) {
      setStatus({ state: 'idle' });
      return;
    }
    const controller: AbortController = new AbortController();
    inflight.current = controller;
    setStatus({ state: 'checking' });
    port.previewCoupon(request, controller.signal).then(
      (answer: CouponPreviewAnswer): void => {
        if (controller.signal.aborted) return;
        inflight.current = undefined;
        if (answer.ok) {
          const coupon: AppliedCoupon = { code: candidate, preview: answer.preview };
          setStatus({ state: 'applied', coupon });
          latest.current.onApplied(coupon);
        } else {
          wanted.current = undefined;
          setStatus({ state: answer.refusal });
          latest.current.onApplied(undefined);
        }
      },
      (): void => {
        // Only an abort rejects, and an aborted question has a newer one behind it.
        if (!controller.signal.aborted) setStatus({ state: 'offline' });
      },
    );
  }, [port]);

  const key: string = planKey(plan);
  const askedFor: MutableRefObject<string> = useRef<string>(key);
  useEffect(() => {
    if (askedFor.current === key) return undefined;
    askedFor.current = key;
    const again: string | undefined = wanted.current;
    if (again === undefined) return undefined;
    setStatus({ state: 'checking' });
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => ask(again), COUPON_RECHECK_DEBOUNCE_MS);
    return (): void => clearTimeout(timer);
  }, [key, ask]);

  useEffect(() => (): void => inflight.current?.abort(), []);

  const withdraw = (): void => {
    inflight.current?.abort();
    inflight.current = undefined;
    wanted.current = undefined;
    if (status.state === 'applied') onApplied(undefined);
  };

  return {
    code,
    status,
    setCode: (raw: string): void => {
      const next: string = normaliseCode(raw);
      if (next === code) return;
      withdraw();
      setCodeText(next);
      setStatus({ state: 'idle' });
    },
    apply: (): void => {
      if (code.length === 0 || status.state === 'checking') return;
      wanted.current = code;
      ask(code);
    },
    remove: (): void => {
      withdraw();
      setCodeText('');
      setStatus({ state: 'idle' });
    },
  };
}
