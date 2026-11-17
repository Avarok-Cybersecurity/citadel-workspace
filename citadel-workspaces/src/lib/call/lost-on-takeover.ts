/**
 * A call whose media could not follow the browser's connection to a new tab.
 *
 * One browser holds one connection to the agent, in whichever Citadel tab
 * leads. When that tab closes and another takes over, the call's media
 * sessions are opened again on the new connection; this is the call's state
 * when that fails (media-session-lifecycle.ts).
 *
 * Its own module because media-session-lifecycle.ts runs from the landing
 * page, and importing this one string from call-failure-detail.ts carried the
 * whole failure copy onto the landing critical path with it.
 */
export const LOST_ON_TAKEOVER: string = "Lost the call's connection when another Citadel tab took over.";
