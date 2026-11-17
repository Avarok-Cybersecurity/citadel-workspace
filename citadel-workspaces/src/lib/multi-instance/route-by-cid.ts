/**
 * Delivering a message to the tab that OWNS its cid.
 *
 * The sibling of route-by-request-id.ts, split out for the same reason and
 * along the same seam: the two paths answer different questions — "who asked
 * for this?" versus "who is this addressed to?" — and confusing them is what
 * `CID_ROUTED_NOTIFICATIONS` exists to prevent.
 *
 * Returns whether the message was DELIVERED, which the leader's inbound handler
 * needs: it runs a second delivery path (`broadcastWorkspaceResponse`) for
 * anything this one did not place, and running both for the same message hands
 * the owning tab a duplicate. A duplicated group invite is a duplicated
 * auto-accept.
 *
 * `true` means every tab entitled to this message has it, or that dropping it
 * was the decision. `false` means something else still has to carry it.
 */
import { instanceChannel } from './instance-channel';
import { instanceManager } from './instance-manager';
import type { InstanceInfo } from './instance-manager';
import { extractTargetCid } from './message-routing';
import { LEADER_MUST_PROCESS_LOCALLY, UNRELIABLE_FORWARDS, arrivesAtFrameRate } from './routing-rules';
import type { OrphanBuffer } from './orphan-buffer';
import { debugLog } from '@/lib/debug-config';

export interface CidRouteDeps {
  orphanBuffer: OrphanBuffer;
  processLocalMessage: (message: unknown) => void;
}

export function routeByCid(
  deps: CidRouteDeps,
  message: Record<string, unknown>,
  messageType: string,
): boolean {
  const targetCid: string | null = extractTargetCid(message);
  if (!arrivesAtFrameRate(messageType)) debugLog('InstanceInboundRouter', `[ILM-Router] Routing ${messageType} (CID: ${targetCid || 'none'})`);

  if (!targetCid) {
    // Nobody can own it, so the leader takes it and the legacy broadcast stays
    // the only way a follower could ever see it. Not delivered.
    deps.processLocalMessage(message);
    return false;
  }

  // EVERY tab holding the session: several tabs of one browser can be signed in
  // to the same account, and each renders what is addressed to it. A response
  // is not routed here -- it goes to the tab that asked (route-by-request-id).
  const targets: string[] = instanceManager.findInstancesByCid(BigInt(targetCid));

  if (targets.length > 0) {
    for (const target of targets) deliverTo(deps, target, targets, targetCid, message, messageType);
    if (!targets.includes(instanceManager.instanceId) && LEADER_MUST_PROCESS_LOCALLY.has(messageType)) {
      debugLog('InstanceInboundRouter', `[ILM-Router] Also processing ${messageType} locally for central state (ILM visibility)`);
      deps.processLocalMessage(message);
    }
    return true; // Every tab holding this CID has it.
  }

  if (messageType === 'ConnectSuccess' || messageType === 'RegisterSuccess') {
    debugLog('InstanceInboundRouter', `[ILM-Router] Registering CID ${targetCid} for self (leader's own connection)`);
    instanceManager.registerInstance(instanceManager.instanceId, BigInt(targetCid));
    deps.processLocalMessage(message);
    return true;
  }

  const knownInstances: InstanceInfo[] = instanceManager.getAllInstances();
  debugLog('InstanceInboundRouter', `[ILM-Router] No instance owns CID ${targetCid}, message may be lost`);
  debugLog('InstanceInboundRouter', `[ILM-Router] Known instances: ${knownInstances.map(i => `${i.instanceId}->${i.cid?.toString()}`).join(', ')}`);

  // Self-heal: buffer the orphan, then replay to the right tab when a cid-report
  // lands, or fall back to processing locally on timeout. Processing on the
  // leader immediately (the old behaviour) misdelivered user-facing
  // notifications on every first message after a stale CID map; the fallback
  // timer still guarantees nothing is stranded.
  if (UNRELIABLE_FORWARDS.has(messageType)) {
    // Dropped, not buffered. A frame replayed after the orphan timeout is two
    // seconds stale, which is a worse artefact than the gap the pipeline
    // already knows how to recover from.
    debugLog('InstanceInboundRouter', `[ILM-Router] Dropping ${messageType} for unowned CID ${targetCid}`);
    instanceChannel.requestCidReport();
    return true; // Deliberately dropped, not awaiting a second path.
  }
  deps.orphanBuffer.push(targetCid, message, messageType);
  instanceChannel.requestCidReport();
  // Buffered, not delivered: no instance owns this CID yet. The legacy
  // broadcast remains as the second chance it has always been, and the
  // receiving tab's own CID filter decides whether to keep it.
  return false;
}

/** Hand `message` to one of the tabs holding its CID; `fanOut` is all of them. */
function deliverTo(
  deps: CidRouteDeps,
  target: string,
  fanOut: string[],
  targetCid: string,
  message: Record<string, unknown>,
  messageType: string,
): void {
  if (target === instanceManager.instanceId) {
    deps.processLocalMessage(message);
    return;
  }
  // Retained until the target acks. No ack within the buffer timeout and the
  // fallback fires (router-forwarding.ts), so a dropped BroadcastChannel post
  // can no longer lose the message. A cid re-registration meanwhile drains and
  // re-routes it, which is the mid-reload recovery path.
  if (UNRELIABLE_FORWARDS.has(messageType)) {
    // Fire and forget; see UNRELIABLE_FORWARDS. Retaining a media frame costs a
    // uuid, a timer and the payload PER FRAME, and its fallback decodes another
    // tab's video on this one.
    instanceChannel.forwardToInstance(target, message);
    return;
  }
  const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
  deps.orphanBuffer.push(targetCid, message, messageType, { requestId, targetInstanceId: target, fanOut });
  instanceChannel.forwardToInstance(target, message, requestId);
}
