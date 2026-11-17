/**
 * The agent's answer to GetAccountInformation is read, not dropped.
 *
 * Nothing handled GetAccountInformationResponse, so "Loading..." stayed as the signed-in
 * user's name (seen live in the leader tab). The WASM client delivers `accounts` as a JS Map
 * with bigint keys (serde-wasm-bindgen without serialize_maps_as_objects).
 */
import { describe, it, expect } from 'vitest';
import { readAccountIdentity } from '../account-identity';

const CID: bigint = 7610457994796114930n;
const answer = (accounts: unknown, request_id: string = 'r1'): Record<string, unknown> => ({ GetAccountInformationResponse: { cid: CID, request_id, accounts } });

describe('readAccountIdentity', () => {
  it('reads the account from the Map the WASM client delivers', () => {
    const accounts: Map<bigint, unknown> = new Map<bigint, unknown>([[CID, { username: 'carol2309d', full_name: 'Carol Bench', peers: new Map() }]]);
    expect(readAccountIdentity(answer(accounts), 'r1', CID)).toEqual({ username: 'carol2309d', fullName: 'Carol Bench' });
  });

  it('reads it from a plain object, and through the Response wrapper', () => {
    const accounts: Record<string, unknown> = { [CID.toString()]: { username: 'carol2309d', full_name: 'Carol Bench' } };
    expect(readAccountIdentity({ Response: answer(accounts) }, 'r1', CID)?.fullName).toBe('Carol Bench');
  });

  it('ignores an answer to a different request, or for a different account', () => {
    const accounts: Map<bigint, unknown> = new Map<bigint, unknown>([[CID, { username: 'carol2309d', full_name: 'Carol Bench' }]]);
    expect(readAccountIdentity(answer(accounts, 'other'), 'r1', CID)).toBeUndefined();
    expect(readAccountIdentity(answer(accounts), 'r1', CID + 1n)).toBeUndefined();
  });
});
