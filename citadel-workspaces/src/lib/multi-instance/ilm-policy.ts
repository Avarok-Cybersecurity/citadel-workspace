/**
 * ILM Routing Policy
 *
 * Which InternalServiceRequest types ride the ILM reliability layer and which
 * bypass it. Extracted piecewise from leader-outbound-handler.ts to keep that
 * file under the size cap; behaviour is unchanged.
 */
import { debugLog } from '@/lib/debug-config';

// Types of messages that should use ILM (reliability layer)
const ILM_REQUIRED_TYPES: string[] = [
  'Message', // P2P messages need ILM
];

// Types that can bypass ILM
const BYPASS_ILM_TYPES: string[] = [
  'GetSessions',
  'LocalDBSetKV',
  'LocalDBGetKV',
  'LocalDBGetAllKV',
  'GetWorkspace',
  'ListWorkspaces',
  'ListMembers',
  'GetMemberInfo',
  'Connect',
  'Register',
  'Disconnect',
  'ConnectionManagement',
  'PeerRegister',
  'PeerConnect',
  'PeerDisconnect',
  'ListAllPeers',
  'ListRegisteredPeers',
];

export function requiresILM(payload: Record<string, unknown>): boolean {
  const messageType: string = Object.keys(payload)[0];

  if (!messageType) {
    return false;
  }

  if (ILM_REQUIRED_TYPES.includes(messageType)) {
    return true;
  }

  if (BYPASS_ILM_TYPES.includes(messageType)) {
    return false;
  }

  debugLog('LeaderOutboundHandler', `[LeaderOutboundHandler] Unknown message type "${messageType}", using ILM`);
  return true;
}
