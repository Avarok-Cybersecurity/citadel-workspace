/**
 * The WASM client hands JS `undefined` for a Rust `None`, never `null`. A status
 * answer for an agent that has not yet checked (and has had no error) therefore
 * arrives with both fields absent, and the settings row must say so rather than
 * print "last checked Invalid Date".
 */
import { describe, it, expect } from 'vitest';
import type { UpdateStatus } from 'citadel-internal-service-wasm-client';
import { versionLine } from '../version-line';
import { fromStatus } from '../update-state';

/** What serde-wasm-bindgen delivers for `last_checked: None, last_error: None`. */
function neverChecked(): UpdateStatus {
  const wire: Omit<UpdateStatus, 'last_checked' | 'last_error'> = {
    cid: 0n, current: '0.9.0', available: null, auto_install: true, request_id: 'r',
  };
  return wire as UpdateStatus;
}

describe('a status from an agent that has never checked', () => {
  it('is normalised to null at the boundary', () => {
    expect(fromStatus(neverChecked())).toEqual({ current: '0.9.0', autoInstall: true, lastChecked: null, lastError: null });
  });

  it('is shown as not checked yet', () => {
    expect(versionLine(fromStatus(neverChecked()), null)).toBe('Citadel Agent 0.9.0, up to date (not checked yet).');
  });
});
