/**
 * The host policy: the standard one is valid, ceilings cannot be exceeded, and the memory
 * maximum is the manifest's request clamped by the policy and the 256 MiB ceiling.
 */
import { describe, expect, it } from 'vitest';
import { PAGE_BYTES as WASM_PAGE_BYTES } from '../../sdk/generated/AbiConstants';
import { HOST_CEILINGS, memoryMaxPagesFor, STANDARD_HOST_POLICY, validateHostPolicy } from '../limits';

describe('host policy', () => {
  it('the standard policy is valid and states the design numbers', () => {
    expect(validateHostPolicy(STANDARD_HOST_POLICY)).toBe(STANDARD_HOST_POLICY);
    expect(STANDARD_HOST_POLICY.memoryMaxPages * WASM_PAGE_BYTES).toBe(64 * 1024 * 1024);
    expect(HOST_CEILINGS.memoryMaxPages * WASM_PAGE_BYTES).toBe(256 * 1024 * 1024);
    expect([STANDARD_HOST_POLICY.computeBudgetMs, STANDARD_HOST_POLICY.hostCallsPerSecond, STANDARD_HOST_POLICY.serverCallsPerSecond, STANDARD_HOST_POLICY.maxLiveInstancesPerPage])
      .toEqual([2000, 200, 20, 8]);
  });

  it('refuses a policy above a ceiling, or with a non-positive limit (control: at the ceiling passes)', () => {
    expect(() => validateHostPolicy({ ...STANDARD_HOST_POLICY, memoryMaxPages: HOST_CEILINGS.memoryMaxPages + 1 })).toThrow(/ceiling/);
    expect(() => validateHostPolicy({ ...STANDARD_HOST_POLICY, computeBudgetMs: 2001 })).toThrow(/ceiling/);
    expect(() => validateHostPolicy({ ...STANDARD_HOST_POLICY, hostCallsPerSecond: 0 })).toThrow(/positive/);
    expect(() => validateHostPolicy({ ...STANDARD_HOST_POLICY, ihttp: { ...STANDARD_HOST_POLICY.ihttp, maxRoutes: -1 } })).toThrow(/ihttp.maxRoutes/);
    expect(validateHostPolicy({ ...STANDARD_HOST_POLICY, memoryMaxPages: HOST_CEILINGS.memoryMaxPages }).memoryMaxPages).toBe(4096);
  });

  it('the memory maximum never exceeds the manifest, the policy or the ceiling', () => {
    expect(memoryMaxPagesFor(16, STANDARD_HOST_POLICY)).toBe(16);
    expect(memoryMaxPagesFor(100_000, STANDARD_HOST_POLICY)).toBe(1024);
    expect(memoryMaxPagesFor(100_000, { ...STANDARD_HOST_POLICY, memoryMaxPages: 4096 })).toBe(4096);
    expect(() => memoryMaxPagesFor(0, STANDARD_HOST_POLICY)).toThrow();
  });
});
