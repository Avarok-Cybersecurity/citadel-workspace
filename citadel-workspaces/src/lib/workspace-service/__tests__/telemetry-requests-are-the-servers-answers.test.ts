/**
 * Every telemetry request resolves with the variant the server answers it with, and rejects with
 * its refusal. The send and the inbound event are doubled, as in the other write-gate tests; the
 * request shapes, the gate and the answer matching are production.
 */
import { describe, expect, it, vi } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';
import type { CurrentTerms, MyConsent, TelemetryFilter, TelemetrySettings } from 'citadel-workspace-client-ts';
import * as ops from '../telemetry-operations';
import type { ProtocolSender } from '../workspace-operations';

type Sender = ProtocolSender & { sent: WorkspaceProtocolRequestTS[] };

function sender(answers: unknown[]): Sender {
  const sent: WorkspaceProtocolRequestTS[] = [];
  return {
    sent,
    currentCid: 7n,
    sendProtocolRequest: vi.fn(async (request: WorkspaceProtocolRequestTS): Promise<void> => {
      sent.push(request);
      for (const response of answers) setTimeout(() => eventEmitter.emit('workspace:raw-response', response), 0);
    }),
  };
}

const CONSENT: MyConsent = {
  accepted_platform_version: 1, accepted_workspace_version: null, required_platform_version: 1,
  required_workspace_version: null, terms_current: true, telemetry_enabled: false, uploads_allowed: false,
};

describe('telemetry requests', () => {
  it('GetTerms is a bare variant and resolves with the terms', async () => {
    const terms: CurrentTerms = { platform: { version: 1, text: 'T' }, workspace: null };
    const s: Sender = sender([{ Telemetry: { Terms: terms } }]);
    expect(await ops.getTerms(s)).toEqual(terms);
    expect(s.sent).toEqual([{ Telemetry: 'GetTerms' }]);
  });

  it('AcceptTerms carries both versions and resolves with the consent', async () => {
    const s: Sender = sender([{ Telemetry: { Consent: CONSENT } }]);
    expect(await ops.acceptTerms(s, 1, 3)).toEqual(CONSENT);
    expect(s.sent).toEqual([{ Telemetry: { AcceptTerms: { platform_version: 1, workspace_version: 3 } } }]);
  });

  it('SetTelemetryConsent sends the flag', async () => {
    const s: Sender = sender([{ Telemetry: { Consent: { ...CONSENT, telemetry_enabled: true } } }]);
    expect((await ops.setTelemetryConsent(s, true)).telemetry_enabled).toBe(true);
    expect(s.sent).toEqual([{ Telemetry: { SetTelemetryConsent: { enabled: true } } }]);
  });

  it('ignores a telemetry answer of another kind and waits for its own', async () => {
    const s: Sender = sender([{ Telemetry: { Deleted: { segments: 2 } } }, { Telemetry: { Consent: CONSENT } }]);
    expect(await ops.getMyConsent(s)).toEqual(CONSENT);
  });

  it('DeleteMyTelemetry resolves with how many segments went', async () => {
    const s: Sender = sender([{ Telemetry: { Deleted: { segments: 4 } } }]);
    expect(await ops.deleteMyTelemetry(s)).toBe(4);
    expect(s.sent).toEqual([{ Telemetry: 'DeleteMyTelemetry' }]);
  });

  it('policy, support access, terms text and the lists put their arguments on the wire', async () => {
    const settings: TelemetrySettings = { policy: { retention_days: 7, per_user_bytes: 1n }, max_retention_days: 90, max_per_user_bytes: 2n, support_access: { enabled: false, until_ms: null } };
    const s: Sender = sender([{ Telemetry: { Settings: settings } }]);
    await ops.setTelemetryPolicy(s, 7, 1n);
    await ops.setSupportAccess(s, true, 99n);
    expect(s.sent).toEqual([
      { Telemetry: { SetTelemetryPolicy: { retention_days: 7, per_user_bytes: 1n } } },
      { Telemetry: { SetSupportAccess: { enabled: true, until_ms: 99n } } },
    ]);
    const t: Sender = sender([{ Telemetry: { Terms: { platform: { version: 1, text: 'T' }, workspace: { version: 2, text: 'W' } } } }]);
    await ops.setWorkspaceTerms(t, 'W');
    expect(t.sent).toEqual([{ Telemetry: { SetWorkspaceTerms: { text: 'W' } } }]);
    const l: Sender = sender([{ Telemetry: { AccessLog: [] } }]);
    expect(await ops.listTelemetryAccessLog(l)).toEqual([]);
    const f: TelemetryFilter = { user_id: null, peer_cid: 5n, min_level: null, since_ms: null, until_ms: null };
    const p: Sender = sender([{ Telemetry: { Page: { records: [], has_more: false } } }]);
    expect(await ops.listTelemetry(p, f, { offset: 0, limit: 50 })).toEqual({ records: [], has_more: false });
    expect(p.sent).toEqual([{ Telemetry: { ListTelemetry: { filter: f, page: { offset: 0, limit: 50 } } } }]);
  });

  it('rejects with the server\'s refusal', async () => {
    const s: Sender = sender([{ Error: 'Permission denied: ViewTelemetry required' }]);
    await expect(ops.getTelemetrySettings(s)).rejects.toThrow('ViewTelemetry required');
  });

  it('a volunteered Consent does not answer a change it does not show', async () => {
    const stale: MyConsent = { ...CONSENT, telemetry_enabled: false };
    const s: Sender = sender([{ Telemetry: { Consent: stale } }, { Telemetry: { Consent: { ...CONSENT, telemetry_enabled: true } } }]);
    expect((await ops.setTelemetryConsent(s, true)).telemetry_enabled).toBe(true);
  });

  it('a volunteered Consent that is not current does not answer AcceptTerms', async () => {
    const s: Sender = sender([{ Telemetry: { Consent: { ...CONSENT, terms_current: false } } }, { Telemetry: { Consent: CONSENT } }]);
    expect((await ops.acceptTerms(s, 1, null)).terms_current).toBe(true);
  });

  it('a volunteered Consent does not answer a request for something else', async () => {
    const terms: CurrentTerms = { platform: { version: 1, text: 'T' }, workspace: null };
    const s: Sender = sender([{ Telemetry: { Consent: CONSENT } }, { Telemetry: { Terms: terms } }]);
    expect(await ops.getTerms(s)).toEqual(terms);
  });
});
