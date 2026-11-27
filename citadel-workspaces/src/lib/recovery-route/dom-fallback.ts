/**
 * A surface drawn before React exists, from DOM APIs only (no innerHTML): main.tsx's boot failure.
 * Its controls are the plan's, labelled by the same table (labels.ts); a report is copied rather
 * than sent, since the reporter is a React dialog and React is what failed.
 */
import { SURFACES, type SurfaceId } from './surfaces';
import { alternativesOf, manualPrimary } from './derive';
import { routeLabel } from './labels';
import type { ManualRoute, RecoveryPlan } from './route';

export interface DomFallbackPorts {
  readonly reload: () => void;
  /** The text a person can paste into a report: redacted, no secrets. */
  readonly reportText: () => string;
  readonly copy: (text: string) => Promise<void>;
}

function button(label: string, testId: string, onClick: () => void): HTMLButtonElement {
  const element: HTMLButtonElement = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.dataset.testid = testId;
  element.style.cssText = 'min-height:44px;padding:0 16px;margin:8px 8px 0 0;border-radius:8px;border:1px solid currentColor;background:transparent;color:inherit;font:inherit;cursor:pointer;';
  element.addEventListener('click', onClick);
  return element;
}

export function domFallback(root: HTMLElement, surface: SurfaceId, message: string, ports: DomFallbackPorts): void {
  const plan: RecoveryPlan = SURFACES[surface];
  const container: HTMLDivElement = document.createElement('div');
  container.setAttribute('role', 'alert');
  container.dataset.testid = `recovery-${surface}`;
  container.style.cssText = 'max-width:36rem;margin:15vh auto;padding:0 16px;font-family:system-ui,sans-serif;line-height:1.5;';
  const heading: HTMLHeadingElement = document.createElement('h1');
  heading.textContent = 'Citadel could not start';
  heading.style.cssText = 'font-size:1.25rem;margin:0 0 8px;';
  const said: HTMLParagraphElement = document.createElement('p');
  said.textContent = message;
  const status: HTMLParagraphElement = document.createElement('p');
  status.setAttribute('role', 'status');
  container.append(heading, said);
  const routes: readonly ManualRoute[] = [manualPrimary(plan), ...alternativesOf(plan)];
  for (const route of routes) {
    if (route.kind === 'reload') container.append(button(routeLabel(route, null), `recovery-control-${route.kind}`, ports.reload));
    else if (route.kind === 'report-bug') {
      container.append(button('Copy a problem report', `recovery-control-${route.kind}`, (): void => {
        ports.copy(ports.reportText()).then(
          (): void => { status.textContent = 'Copied. Paste it into a problem report once Citadel opens, or give it to your workspace admin.'; },
          (): void => { status.textContent = 'The browser did not allow copying.'; },
        );
      }));
    }
  }
  container.append(status);
  root.textContent = '';
  root.appendChild(container);
}
