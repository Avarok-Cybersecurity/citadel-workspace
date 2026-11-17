import { describe, expect, it } from 'vitest';
import { readAccountLevels, securityLevelName, securityLevelValue } from '../account-levels';

const answer = (requestId: string, accounts: unknown): Record<string, unknown> => ({
  GetAccountInformationResponse: { cid: 0n, request_id: requestId, accounts },
});

describe('the level each stored account signs in at', () => {
  it('reads named and custom levels as the SDK orders them', () => {
    expect(securityLevelValue('Standard')).toBe(0);
    expect(securityLevelValue('Extreme')).toBe(4);
    expect(securityLevelValue({ Custom: 9 })).toBe(9);
    expect(securityLevelValue('Nonsense')).toBeNull();
    expect(securityLevelName(4)).toBe('Extreme');
    expect(securityLevelName(9)).toBe('custom level 9');
  });

  it("maps each username to its level, from the WASM client's Map or a plain object", () => {
    const fromWasm: Map<bigint, unknown> = new Map<bigint, unknown>([
      [1n, { username: 'alice', registered_security_level: 'Standard' }],
      [2n, { username: 'bob', registered_security_level: 'High' }],
    ]);
    expect([...(readAccountLevels(answer('r1', fromWasm), 'r1') ?? new Map())]).toEqual([['alice', 0], ['bob', 2]]);
    const plain: Record<string, unknown> = { '3': { username: 'carol', registered_security_level: { Custom: 7 } } };
    expect([...(readAccountLevels({ Response: answer('r2', plain) }, 'r2') ?? new Map())]).toEqual([['carol', 7]]);
  });

  it('leaves out an account the agent sent no level for, so nothing is disabled for it', () => {
    // null from JSON, undefined from WASM (memory: WASM None is undefined), absent from an older agent.
    const accounts: Record<string, unknown> = {
      '1': { username: 'a', registered_security_level: null },
      '2': { username: 'b', registered_security_level: undefined },
      '3': { username: 'c' },
    };
    expect(readAccountLevels(answer('r', accounts), 'r')?.size).toBe(0);
  });

  it('ignores answers to other requests', () => {
    expect(readAccountLevels(answer('other', {}), 'r1')).toBeNull();
    expect(readAccountLevels({ ConnectSuccess: {} }, 'r1')).toBeNull();
    expect(readAccountLevels(null, 'r1')).toBeNull();
  });
});
