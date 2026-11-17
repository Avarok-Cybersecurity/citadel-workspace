/** Constants shared by the call manager and its extracted collaborators. */

/** Bumped when the frame wire format changes. */
export const MEDIA_WIRE_VERSION: number = 1;

/** How long an unanswered call rings before giving up. */
export const RING_TIMEOUT_MS: number = 45_000;

/**
 * How long `connecting` may last before the call is declared failed.
 *
 * Shorter than the ring timeout because the peer has already answered: the
 * media sessions either open promptly or are not going to. Without any bound
 * here `connecting` is a reachable resting state — the ring timer is retired
 * on the transition INTO it, and the heartbeat watchdog does not arm until
 * `active` — so the call sits with the camera live and no timer anywhere.
 */
export const CONNECT_TIMEOUT_MS: number = 30_000;

/**
 * How often each participant announces it is still there, on the reliable path.
 *
 * A call currently ends on the far side only when a CallEnd arrives. If that
 * signal is delayed or lost — a tab closed hard, a laptop lid shut, a network
 * that drops — the other person is left sitting in a call that is over, with
 * their camera on. Absence of media frames is NOT a substitute: a participant
 * who muted and turned their camera off sends nothing and is still present.
 */
export const CALL_HEARTBEAT_INTERVAL_MS: number = 5_000;

/**
 * How long a participant may go unheard before being treated as gone.
 *
 * Four missed heartbeats. Long enough that an ordinary network stall or a
 * backgrounded tab does not eject someone mid-sentence, short enough that a
 * dead call does not linger.
 */
export const CALL_HEARTBEAT_TIMEOUT_MS: number = 20_000;

/**
 * How long the signal queue waits on one send before letting the next go.
 *
 * Signal sends are serialised so a fan-out cannot interleave and lose one. The
 * send path is unbounded, though — sendP2PCommand reaches the WASM messenger
 * with no timeout anywhere along it — so a single stalled send would otherwise
 * hold every later signal behind it indefinitely, including the CallEnd that
 * ordering was protecting in the first place.
 *
 * This bounds only what the NEXT send waits for, never the send itself: the
 * caller still awaits its own result. Ordering therefore holds in the normal
 * case and degrades to concurrent exactly when waiting has become worse than
 * sending out of order.
 */
export const SIGNAL_QUEUE_MAX_WAIT_MS: number = 3_000;
