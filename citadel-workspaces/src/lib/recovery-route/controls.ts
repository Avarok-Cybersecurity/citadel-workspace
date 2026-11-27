/**
 * A plan's routes as controls a person can press, the plan's own first choice first. Pure: what a control
 * does is a port call or a binding call, made only when it is run.
 *
 * A binding is checked where its route runs. The types already demand every field a plan's
 * routes need (binding.ts), so a missing one here is a bug in the caller's cast, and it fails
 * loudly rather than rendering a control that does nothing.
 */
import type { AnyBinding, OtherMember } from './binding';
import { alternativesOf, manualPrimary } from './derive';
import { routeLabel } from './labels';
import type { AskOutcome, RecoveryPorts } from './ports';
import type { ManualRoute, RecoveryPlan } from './route';
import { ROUTE_STEPS } from './steps';

/** Run a control: resolves to a sentence to show beside it ("Sent to 2 admins"), or null. */
export type RunControl = () => Promise<string | null>;

export interface Control {
  readonly kind: ManualRoute['kind'];
  readonly label: string;
  readonly steps: number;
  readonly run: RunControl;
}

function need<T>(value: T | undefined, field: string, kind: string): T {
  if (value === undefined) throw new Error(`the ${kind} route needs the binding's ${field}`);
  return value;
}

const done = (act: () => void): RunControl => async (): Promise<string | null> => {
  act();
  return null;
};

export function controlFor(route: ManualRoute, binding: AnyBinding, ports: RecoveryPorts, surface: string): Control {
  const named: string | null = route.kind === 'contact-member' ? binding.member?.name ?? null : null;
  const label: string = routeLabel(route, named);
  const steps: number = ROUTE_STEPS[route.kind];
  const make = (run: RunControl): Control => ({ kind: route.kind, label, steps, run });
  switch (route.kind) {
    case 'retry': {
      const retry: () => Promise<void> = need(binding.retry, 'retry', route.kind);
      return make(async (): Promise<string | null> => { await retry(); return null; });
    }
    case 'reload': return make(done((): void => ports.reload()));
    case 'apply-update': return make(done((): void => ports.applyUpdate()));
    case 'claim-session': {
      const claim: () => Promise<void> = need(binding.claim, 'claim', route.kind);
      return make(async (): Promise<string | null> => { await claim(); return null; });
    }
    case 'sign-in-again': {
      const account: string = need(binding.account, 'account', route.kind);
      return make(done((): void => ports.signIn(account)));
    }
    case 'fix-input': return make(done(need(binding.focus, 'focus', route.kind)));
    case 'open-setting': return make(done((): void => ports.openSettings(route.tab)));
    case 'navigate': return make(done((): void => ports.navigate(route.to)));
    case 'ask-admin': {
      const about: string = need(binding.askAbout, 'askAbout', route.kind);
      return make(async (): Promise<string | null> => {
        const outcome: AskOutcome = await ports.askAdmins(route.request, about);
        if (outcome.kind === 'refused') return outcome.sentence;
        return outcome.admins === 1 ? 'Sent to 1 admin. It is in their Scratchpad.' : `Sent to ${outcome.admins} admins. It is in their Scratchpads.`;
      });
    }
    case 'contact-member': {
      const member: OtherMember = need(binding.member, 'member', route.kind);
      const draft: string = need(binding.draft, 'draft', route.kind);
      return make(done((): void => ports.openChat(member, draft)));
    }
    case 'install-agent': return make(done((): void => ports.installAgent(route.reason)));
    case 'grant-permission': return make(done((): void => ports.requestPermission(route.permission)));
    case 'report-bug': return make(done((): void => ports.reportBug(surface)));
    case 'acknowledge': return make(done(need(binding.dismiss, 'dismiss', route.kind)));
  }
}

/** The manual controls a plan offers: its primary (or its wait's fallback) first, then the rest. */
export function controlsFor(plan: RecoveryPlan, binding: AnyBinding, ports: RecoveryPorts, surface: string): readonly Control[] {
  const routes: readonly ManualRoute[] = [manualPrimary(plan), ...alternativesOf(plan)];
  return routes.map((route: ManualRoute): Control => controlFor(route, binding, ports, surface));
}
