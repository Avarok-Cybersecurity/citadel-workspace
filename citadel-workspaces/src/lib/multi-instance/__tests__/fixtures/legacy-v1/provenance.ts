/**
 * Protocol 1, frozen on 2026-10-21: the election and dispatch of citadel-workspace-ui
 * 69a7eb2e, the build deployed before the channel envelope (`v`) existed.
 *
 * Tabs of that build stay open across the deploy that ships protocol 2, so the new build has
 * to be proven against this code exactly as it is, not against a description of it:
 * instance-channel, channel-leader-election, channel-message-dispatch and channel-messaging
 * are byte-for-byte that commit, except that their imports of modules NOT frozen here point
 * at the live ones (the instance manager, the queue, the routing they share with any build),
 * and two blank lines were dropped from instance-channel to keep it under the length cap.
 *
 * Delete this directory with legacy-v1-put-down.ts.
 */
export const FROZEN_FROM: { readonly commit: string; readonly date: string } = { commit: '69a7eb2e', date: '2026-10-21' };
