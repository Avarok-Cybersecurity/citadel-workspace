/**
 * WASM Peer Bridge
 *
 * Bridge between TypeScript frontend and WASM ILM (Intersession Layer Messaging).
 * Provides peer connection data to WASM via a global callback function.
 *
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║                        CID LIFECYCLE - CRITICAL INFO                         ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║ CID (Client ID) is a persistent 64-bit identifier assigned per account.      ║
 * ║                                                                              ║
 * ║ | Operation              | CID Behavior                                     |║
 * ║ |------------------------|--------------------------------------------------|║
 * ║ | Register (new account) | NEW CID assigned                                 |║
 * ║ | Login (credentials)    | SAME CID preserved                               |║
 * ║ | ClaimSession (orphan)  | SAME CID preserved                               |║
 * ║ | C2S disconnect+reconnect| SAME CID preserved, rekey works                 |║
 * ║ | TCP drop with orphan   | SAME CID, session persists on server             |║
 * ║                                                                              ║
 * ║ IMPORTANT: Only Register creates a new CID. All reconnection scenarios       ║
 * ║ (login, claim, TCP reconnect) preserve the original CID.                     ║
 * ║                                                                              ║
 * ║ For P2P messaging, this means:                                               ║
 * ║ - Offline messages queued by CID will be delivered on reconnect              ║
 * ║ - ILM tracks messages by CID pairs (sender_cid, receiver_cid)                ║
 * ║ - Peer connections are associated with CIDs, not usernames                   ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 *
 * This is the key component for making TypeScript the single source of truth
 * for peer connection state. The Rust WASM `connected_peers()` function calls
 * into this JavaScript function instead of maintaining its own internal state.
 *
 * Flow:
 * 1. WASM ILM polls connected_peers() every ~200ms
 * 2. connected_peers() calls window.__citadel_get_peers_for_session(localCid)
 * 3. This function queries P2PAutoConnectService.getPeersForSession(cid)
 * 4. Returns array of peer CIDs as BigUint64Array for WASM consumption
 */

import { p2pAutoConnectService } from './p2p-auto-connect-service';
import { debugLog } from '@/lib/debug-config';

/**
 * Global function callable from WASM via wasm_bindgen.
 *
 * The Rust side calls:
 *   window.__citadel_get_peers_for_session(local_cid) -> BigUint64Array
 *
 * @param localCid - The local session CID (as bigint from WASM)
 * @returns BigUint64Array of peer CIDs that are currently connected
 */
// DEBUG: Rate-limited logging for diagnostic purposes
let lastLogTime: number = 0;
const LOG_INTERVAL_MS: number = 3000; // Log once every 3 seconds
let callCount: number = 0;

function __citadel_get_peers_for_session(localCid: bigint): BigUint64Array {
  callCount++;

  try {
    if (!p2pAutoConnectService) {
      debugLog('WasmPeerBridge', `CALL #${callCount} - p2pAutoConnectService NOT AVAILABLE!`);
      return new BigUint64Array(0);
    }

    const peers: bigint[] = p2pAutoConnectService.getPeersForSession(localCid);

    // DEBUG: Rate-limited logging to trace peer lookups
    const now: number = Date.now();
    if (now - lastLogTime > LOG_INTERVAL_MS || peers.length > 0) {
      lastLogTime = now;
      // ILM-DIAG: Log full CID for comparison with setPeerConnected logs
      debugLog('WasmPeerBridge', `[ILM-DIAG][WasmPeerBridge] QUERY localCid=${localCid.toString()} -> ${peers.length} peers`,
        peers.length > 0 ? peers : '(none)');
    }

    // Convert bigint array to BigUint64Array for WASM
    return new BigUint64Array(peers);
  } catch (error) {
    debugLog('WasmPeerBridge', `CALL #${callCount} Error:`, error);
    return new BigUint64Array(0);
  }
}

// Expose the function globally for WASM to call
declare global {
  interface Window {
    __citadel_get_peers_for_session: typeof __citadel_get_peers_for_session;
  }
}

/**
 * Initialize the WASM Peer Bridge.
 * Must be called before WASM starts polling connected_peers().
 * Typically called in main.tsx during app initialization.
 */
export function initWasmPeerBridge(): void {
  if (typeof window !== 'undefined') {
    window.__citadel_get_peers_for_session = __citadel_get_peers_for_session;
    debugLog('WasmPeerBridge', '[WasmPeerBridge] Initialized - global callback registered');
  } else {
    debugLog('WasmPeerBridge', 'Window not available - skipping initialization');
  }
}
