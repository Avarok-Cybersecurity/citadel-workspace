/**
 * P2P Auto-Connect Service Module
 *
 * Re-exports all public API from the split module files.
 * Consuming files can import from '@/lib/p2p-auto-connect-service' unchanged.
 */

// Types (originally exported from the monolith)
export type { PeerConnectionInfo } from './types';

// Main Service class + singleton (originally exported from the monolith)
export { P2PAutoConnectService } from './service';

import { P2PAutoConnectService } from './service';
import { supervision } from '../agent-conversations/capabilities';
import { debugLog } from '../debug-config';

export const p2pAutoConnectService: P2PAutoConnectService = P2PAutoConnectService.getInstance();

// The agent says whether it supervises after this module loads, and only a supervising agent reports.
supervision.subscribe((): void => {
  if (supervision.get() !== true) return;
  import('../agent-supervisor/wire-up').then(
    (m): void => m.standDownAndListen(p2pAutoConnectService),
    (error: unknown): void => { debugLog('AgentSupervisor', 'wire-up not loaded:', error); },
  );
});
