import { eventEmitter } from '@/lib/event-emitter';

/**
 * What a door does when it refuses to open because the agent is unreachable.
 *
 * Every control on the landing screen needs the agent, and none of them opens
 * without it -- see use-agent-gate.ts for why that refusal is right. What the
 * refusal must NOT be is silent. `ConnectionRetryModal` is the surface that
 * explains the state and carries the download link and the command to run, and
 * a dismissal of it STICKS (deliberately: connection-retry-visibility explains
 * why a retry failing again is not worth reopening for). So after a dismissal
 * the refusal had nothing left to point at, and Sign In and Create Account both
 * answered a click with nothing at all.
 *
 * ONE function, called by both, rather than the emit written out at each door.
 * The reason is in use-agent-gate.ts's own history: round 635 applied this rule
 * to Create Account and not to Sign In, the button immediately beside it, and
 * the first fix for THAT went to Sign In and not back to Create Account. Two
 * doors, one rule, and it has now reached one of them twice. A third door gets
 * this by calling it, not by remembering to.
 */
export function askWhyTheAgentIsUnreachable(): void {
  eventEmitter.emit('connection:retry-requested');
}
