/**
 * This tab's one escalation of a session's server link into the full-page notice (outage.ts),
 * on the real clock. Apart from the rule so the rule is tested against a clock of its own.
 */
import { createEscalation, outage, type Escalation } from './outage';

export const linkOutage: Escalation = createEscalation({
  after: (ms: number, run: () => void): (() => void) => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(run, ms);
    return (): void => clearTimeout(timer);
  },
  show: outage.set,
});
