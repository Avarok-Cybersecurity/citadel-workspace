/** The wire names, defined once (types/agent-supervisor.ts), and what reads and writes them. */
import { describe, it, expect } from 'vitest';
import {
  INTEREST_COMMAND, SUPERVISES_P2P_CAPABILITY, SUPERVISOR_NOTIFICATION, greetingSupervises,
} from '@/types/agent-supervisor';
import { readSupervisorEvent } from '../status';
import { interestRequest } from '../interest';

describe('the capability', () => {
  it('is declared by a greeting that says so, and by no other', () => {
    expect(greetingSupervises({ [SUPERVISES_P2P_CAPABILITY]: true })).toBe(true);
    expect(greetingSupervises({ [SUPERVISES_P2P_CAPABILITY]: false })).toBe(false);
    expect(greetingSupervises({ cid: 0n })).toBe(false);
    expect(greetingSupervises({ [SUPERVISES_P2P_CAPABILITY]: 'true' })).toBe(false);
  });
});

describe('a supervisor notification', () => {
  const body = (extra: Record<string, unknown>): unknown => ({ [SUPERVISOR_NOTIFICATION]: { cid: 1n, request_id: null, ...extra } });

  it('reads each state, with or without a peer', () => {
    expect(readSupervisorEvent(body({ peer_cid: 2n, state: 'Healing' }))).toEqual({ cid: 1n, peerCid: 2n, state: 'healing' });
    expect(readSupervisorEvent(body({ peer_cid: null, state: 'Healed' }))).toEqual({ cid: 1n, peerCid: null, state: 'healed' });
    // serde-wasm-bindgen: a Rust None is undefined.
    expect(readSupervisorEvent(body({ state: 'Degraded' }))).toEqual({ cid: 1n, peerCid: null, state: 'degraded' });
  });

  it('reads one the Response wrapper carries', () => {
    expect(readSupervisorEvent({ Response: body({ state: 'Healing' }) })).toEqual({ cid: 1n, peerCid: null, state: 'healing' });
  });

  it.each([
    ['an unknown state', body({ state: 'Sleeping' })],
    ['a string cid', { [SUPERVISOR_NOTIFICATION]: { cid: '1', state: 'Healing' } }],
    ['a string peer', body({ peer_cid: '2', state: 'Healing' })],
    ['another notification', { PeerConnectSuccess: { cid: 1n, state: 'Healing' } }],
    ['null', null],
  ])('does not read %s', (_name: string, message: unknown) => {
    expect(readSupervisorEvent(message)).toBeNull();
  });
});

describe('the Interest request', () => {
  it('names the session, the peer and when it lapses', () => {
    expect(interestRequest('r1', 1n, 2n, 5000)).toEqual({
      ConnectionManagement: { request_id: 'r1', management_command: { [INTEREST_COMMAND]: { session_cid: 1n, peer_cid: 2n, until: 5000n } } },
    });
  });
});
