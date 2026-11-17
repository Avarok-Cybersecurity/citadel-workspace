/**
 * Work a closing tab must hand to the leader BEFORE it asks the leader to release its session.
 *
 * The order is the point. A follower's last act on `pagehide` is `session-release`
 * (channel-lifecycle.ts), and the leader acts on it at once: ReleaseSession takes the session off
 * the leader's connection, and the agent then refuses anything the leader sends as that session.
 * A step that hands over work done AS the session -- a call's goodbye (call-departure.ts) -- has
 * to reach the leader first. Registering a second `pagehide` listener did not guarantee that: the
 * channel registers its own at module load, so it ran first, the release overtook the goodbye,
 * and the peer was left in a call the closed tab could no longer end.
 *
 * Steps run synchronously, in registration order; a BroadcastChannel post is synchronous and the
 * channel delivers one sender's messages in order, so what a step posts arrives before the
 * release.
 */
const steps: Set<() => void> = new Set<() => void>();

/** Run `step` on departure, ahead of the release. Returns its removal. */
export function addDepartureStep(step: () => void): () => void {
  steps.add(step);
  return (): void => { steps.delete(step); };
}

/** Every registered step. One that throws does not stop the rest, nor the release after them. */
export function runDepartureSteps(report: (error: unknown) => void): void {
  for (const step of [...steps]) {
    try {
      step();
    } catch (error: unknown) {
      report(error);
    }
  }
}
