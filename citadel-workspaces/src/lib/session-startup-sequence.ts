/**
 * The ordered session startup sequence.
 *
 * Owns WHAT happens when a session activates and in what order: connection
 * state reset for reconnections, the SDK teardown settle delay, ILM/WASM
 * startup, P2P registration and auto-connect, and the completion events.
 * Split from session-startup-service.ts so the service keeps activation
 * gating/dedup while the sequence itself lives here.
 */

import { eventEmitter } from './event-emitter';
import { p2pRegistrationService } from './p2p-registration-service';
import { p2pAutoConnectService } from './p2p-auto-connect-service';
import { startMessagingForSession } from './start-messaging';
import { toast } from '@/hooks/use-toast';
import { debugLog } from '@/lib/debug-config';
import type { SessionActivatedEvent } from './session-startup-service';

/**
 * How long to let the backend settle after a login before starting P2P setup.
 * A placeholder for a readiness signal the internal service does not yet emit —
 * see the @human-review note at its use site.
 */
const SDK_TEARDOWN_SETTLE_MS: number = 2000;

export async function runStartupSequence(
  event: SessionActivatedEvent,
  markReconnectionComplete: () => void,
): Promise<void> {
  try {
    // 0. For reconnection scenarios (ClaimSession OR Login), reset connection state
    // This is CRITICAL because:
    // - For ClaimSession: TCP drops with orphan mode, PeerDisconnect is NOT sent to peers
    //   So peers' connectedPeers Set still has this user's CID
    // - For Login: After explicit disconnect, the previous session is destroyed
    //   A new session with a new CID is created, but local state may be stale
    //
    // By resetting state, we ensure fresh PeerConnect calls that properly
    // establish bidirectional channels.
    if (event.activationType === 'claim' || event.activationType === 'login') {
      debugLog('SessionStartupService', `SessionStartup: Resetting connection state for ${event.activationType}`);
      await p2pAutoConnectService.resetConnectionState();
    }

    // 0.25. For login reconnections, wait for the backend to finish tearing down
    // the previous session before we establish a new P2P one: the old
    // Connection's channel drops have to propagate through the protocol layer
    // first.
    //
    // @human-review This is a fixed delay standing in for a signal we do not
    // have. It is a guess in both directions — too short on a loaded backend and
    // it races anyway; too long and every login pays the difference. It is kept
    // because the alternative today is blind-changing P2P connection sequencing,
    // historically the flakiest area of this codebase, with nothing to verify
    // against.
    //
    // The real fix is on the backend: the internal service knows exactly when
    // the old Connection's channels are released, and should emit that. Once it
    // does, replace this with waitForEvent(...) from lib/utils/scheduling — the
    // login path then proceeds the instant teardown completes instead of always
    // costing SDK_TEARDOWN_SETTLE_MS. Tracked in docs/KNOWN_ISSUES.md.
    if (event.activationType === 'login') {
      debugLog('SessionStartupService', `SessionStartup: Waiting ${SDK_TEARDOWN_SETTLE_MS}ms for SDK stabilization after login`);
      await new Promise(resolve => setTimeout(resolve, SDK_TEARDOWN_SETTLE_MS));
    }

    // 0.5. CRITICAL: Start WASM connection manager to open ILM messenger handle
    // This MUST happen before P2P operations so that the ILM layer is ready
    // to send and receive messages. Without this, ACKs are never sent for
    // inbound messages, causing outbound messages to block waiting for ACKs.
    // Startup continues either way -- P2P may still work without ILM -- but the
    // failure is no longer silent. It used to be caught into a debugLog, which
    // is stripped from production, so a session whose messaging never came up
    // was indistinguishable from a healthy one until messages stopped arriving.
    await startMessagingForSession(event.cid);

    // 1. Start P2P registration service (idempotent - won't restart if already running)
    // This handles peer discovery and registration notifications
    await p2pRegistrationService.start({ autoRegisterAll: false });
    debugLog('SessionStartupService', 'SessionStartup: P2P Registration Service started');

    // 2. Connect to all registered peers
    // CRITICAL: This is what was missing after ClaimSession!
    // Without this, Alice's ILM never sees Bob as connected
    await p2pAutoConnectService.connectToAllRegisteredPeers();
    debugLog('SessionStartupService', 'SessionStartup: P2P Auto-Connect initiated for all registered peers');

    // 3. Track reconnection completion time for grace period logic
    if (event.activationType === 'claim' || event.activationType === 'login') {
      markReconnectionComplete();
    }

    // 4. Emit completion event for any listeners that need to know startup is done
    eventEmitter.emit('session:startup-complete', event);
    debugLog('SessionStartupService', `SessionStartup: Startup sequence complete for ${event.username}`);
  } catch (error) {
    debugLog('SessionStartupService', 'Error during startup sequence:', error);
    // Toasted, not emitted. 'session:startup-error' had no listener anywhere, so
    // this wrapped the whole post-login startup — P2P registration and
    // auto-connect — and reported a total failure to nobody. The user had just
    // been told "Connected to workspace successfully" while their messaging
    // layer never came up: peers offline, messages not arriving, no error.
    toast({
      variant: 'destructive',
      title: 'Messaging may be unavailable',
      description: 'Some background services failed to start. Reload to try again.',
    });
  }
}
