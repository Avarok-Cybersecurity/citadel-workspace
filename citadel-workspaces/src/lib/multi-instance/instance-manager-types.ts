/**
 * Instance Manager Types
 *
 * Type definitions for the multi-instance architecture.
 */

export interface InstanceState {
  instanceId: string;
  cid: bigint | null;
  isLeader: boolean;
  leaderId: string | null;
}

export interface InstanceInfo {
  instanceId: string;
  cid: bigint | null;
}
