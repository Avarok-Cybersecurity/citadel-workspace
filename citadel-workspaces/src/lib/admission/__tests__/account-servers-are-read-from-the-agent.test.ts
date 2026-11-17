// @vitest-environment node
/**
 * Which workspace each of the agent's accounts is on, read off its
 * GetAccountInformation answer: what a sign-in's human check is bound to.
 */
import { describe, expect, it } from 'vitest';
import { readAccountHosts, readAccountServers } from '../account-servers';

const answer = (requestId: string, accounts: unknown): unknown => ({ GetAccountInformationResponse: { cid: 0n, request_id: requestId, accounts } });

describe('the agent\'s account servers', () => {
  it('maps each account to the host it registered to, from the WASM client\'s Map or a plain object', () => {
    const fromWasm: Map<bigint, unknown> = new Map<bigint, unknown>([
      [1n, { username: 'alice', full_name: 'A', peers: {}, server_host: 'bench.work.avarok.net' }],
      [2n, { username: 'bob', full_name: 'B', peers: {}, server_host: null }],
    ]);
    expect([...(readAccountServers(answer('r1', fromWasm), 'r1') ?? new Map())]).toEqual([['alice', 'bench.work.avarok.net']]);
    const plain: unknown = { 3: { username: 'carol', server_host: ' acme.work.avarok.net ' } };
    expect([...(readAccountServers({ Response: answer('r2', plain) }, 'r2') ?? new Map())]).toEqual([['carol', 'acme.work.avarok.net']]);
  });

  it('is not this request\'s answer when the id or the shape differs', () => {
    expect(readAccountServers(answer('other', {}), 'r1')).toBeNull();
    expect(readAccountServers({ ConnectSuccess: {} }, 'r1')).toBeNull();
    expect(readAccountServers(null, 'r1')).toBeNull();
  });

  it('keeps the same username on two workspaces as two accounts', () => {
    const two: Map<bigint, unknown> = new Map<bigint, unknown>([
      [1n, { username: 'alice', server_host: 'bench.work.avarok.net' }],
      [2n, { username: 'alice', server_host: 'acme.work.avarok.net' }],
    ]);
    expect(readAccountHosts(answer('r3', two), 'r3')).toEqual([
      { username: 'alice', server: 'bench.work.avarok.net' }, { username: 'alice', server: 'acme.work.avarok.net' },
    ]);
  });
});
