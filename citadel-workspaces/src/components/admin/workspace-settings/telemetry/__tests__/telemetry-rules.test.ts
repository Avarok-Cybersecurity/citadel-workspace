import { describe, it, expect } from 'vitest';
import type { TelemetrySettings } from 'citadel-workspace-client-ts';
import { EMPTY_FILTER_FORM, filterFromForm, megabytesOf, policyFromForm, supportAccessUntil, type FilterResult } from '../telemetry-rules';

const SETTINGS: TelemetrySettings = {
  policy: { retention_days: 30, per_user_bytes: 20n * 1024n * 1024n }, max_retention_days: 90, max_per_user_bytes: 50n * 1024n * 1024n,
  support_access: { enabled: false, until_ms: null },
};

describe('filterFromForm', () => {
  it('an empty form filters nothing', () => {
    expect(filterFromForm(EMPTY_FILTER_FORM)).toEqual({ ok: true, filter: { user_id: null, peer_cid: null, min_level: null, since_ms: null, until_ms: null } });
  });
  it('reads a peer CID as a bigint, however large', () => {
    const r: FilterResult = filterFromForm({ ...EMPTY_FILTER_FORM, peerCidText: '18446744073709551615', user: ' alice ', minLevel: 'Error' });
    expect(r).toMatchObject({ ok: true, filter: { peer_cid: 18446744073709551615n, user_id: 'alice', min_level: 'Error' } });
  });
  it('refuses a CID that is not a u64', () => {
    expect(filterFromForm({ ...EMPTY_FILTER_FORM, peerCidText: '12ab' }).ok).toBe(false);
    expect(filterFromForm({ ...EMPTY_FILTER_FORM, peerCidText: '18446744073709551616' }).ok).toBe(false);
  });
  it('turns local times into milliseconds and refuses a reversed range', () => {
    const r: FilterResult = filterFromForm({ ...EMPTY_FILTER_FORM, since: '2026-10-01T00:00', until: '2026-10-02T00:00' });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.filter.until_ms! - r.filter.since_ms!).toBe(86_400_000n);
    expect(filterFromForm({ ...EMPTY_FILTER_FORM, since: '2026-10-02T00:00', until: '2026-10-01T00:00' }).ok).toBe(false);
  });
});

describe('policyFromForm', () => {
  it('accepts values within the reported maximums', () => {
    expect(policyFromForm('90', '50', SETTINGS)).toEqual({ ok: true, retentionDays: 90, perUserBytes: 50n * 1024n * 1024n });
  });
  it('refuses more than the server allows, and says the limit', () => {
    expect(policyFromForm('91', '10', SETTINGS)).toEqual({ ok: false, problem: 'Retention can be at most 90 days.' });
    expect(policyFromForm('30', '51', SETTINGS)).toEqual({ ok: false, problem: 'Storage can be at most 50 MB per person.' });
  });
  it('refuses zero, fractions and words', () => {
    for (const [d, m] of [['0', '5'], ['1.5', '5'], ['x', '5'], ['5', '0'], ['5', '2.5'], ['5', '']]) expect(policyFromForm(d, m, SETTINGS).ok).toBe(false);
  });
  it('shows stored bytes as whole megabytes', () => { expect(megabytesOf(SETTINGS.policy.per_user_bytes)).toBe('20'); });
});

describe('supportAccessUntil', () => {
  it('is the given days after now', () => { expect(supportAccessUntil(7, 1000)).toBe(1000n + 7n * 86_400_000n); });
});
