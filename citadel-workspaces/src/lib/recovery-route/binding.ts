/**
 * What a surface hands its routes at render time, derived from its plan: a plan that offers
 * `contact-member` does not compile without the member, one that waits does not compile without
 * the signal that ends the wait. That last rule is the point of the module: "you'll join when
 * they do" with nothing subscribed to "they did" cannot be written.
 */
import type { ManualRoute, RecoveryPlan, RecoveryRoute, RouteKind } from './route';

/** An account to sign back in to, by the username `signInNeededFor` keys on. */
export type AccountRef = string;

declare const otherMemberBrand: unique symbol;

/** A member who is not the viewer. Only `otherMember` makes one (other-member.ts). */
export interface OtherMember {
  readonly cid: bigint;
  readonly name: string | null;
  readonly [otherMemberBrand]: true;
}

/** Subscribes `resume` to the event that ends a wait; returns the unsubscribe. */
export type Wake = (resume: () => void) => () => void;

export interface RouteNeeds {
  retry: { readonly retry: () => Promise<void> };
  'retry-auto': { readonly retry: () => Promise<void> };
  wait: { readonly wake: Wake };
  reload: object;
  'apply-update': object;
  'claim-session': { readonly claim: () => Promise<void> };
  'sign-in-again': { readonly account: AccountRef };
  'fix-input': { readonly focus: () => void };
  'open-setting': object;
  navigate: object;
  'ask-admin': { readonly askAbout: string };
  'contact-member': { readonly member: OtherMember; readonly draft: string };
  'install-agent': object;
  'grant-permission': object;
  'report-bug': object;
  acknowledge: { readonly dismiss: () => void };
}

type ThenKind<R extends RecoveryRoute> = R extends { readonly then: infer T extends ManualRoute } ? T['kind'] : never;

/** Every route kind a plan can show: its primary, a wait's fallback, and its alternatives. */
export type KindsOf<P extends RecoveryPlan> = P['primary']['kind'] | ThenKind<P['primary']> | P['alternatives'][number]['kind'];

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

/** The binding a plan's surface must supply. */
export type BindingOf<P extends RecoveryPlan> = UnionToIntersection<RouteNeeds[KindsOf<P>]>;

/** Any binding, as the renderer reads it: each field checked where its route runs. */
export type AnyBinding = Partial<UnionToIntersection<RouteNeeds[RouteKind]>>;
