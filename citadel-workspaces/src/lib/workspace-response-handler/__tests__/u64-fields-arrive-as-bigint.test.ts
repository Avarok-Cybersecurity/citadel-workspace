/**
 * Workspace Settings crashed for admins on the live site: "Cannot mix BigInt and other types" in
 * the Telemetry section, dividing `per_user_bytes` by a bigint. The types promise bigint for every
 * u64; this receive path decoded the server's JSON with a bare JSON.parse, so each one arrived as
 * a number -- and any above 2^53 silently lost its low digits.
 */
import { describe, it, expect } from 'vitest';
import { extractWorkspaceResponse } from '../message-extraction';

const notificationCarrying = (json: string): unknown => ({
  MessageNotification: { cid: 7n, peer_cid: 0n, request_id: null, message: Array.from(new TextEncoder().encode(json)) },
});

describe('a workspace response received from the server', () => {
  it('carries u64 limits as bigint, so the Telemetry section can compute with them', () => {
    const json: string = '{"Response":{"Telemetry":{"Settings":{"policy":{"retention_days":30,"per_user_bytes":20971520},"max_per_user_bytes":52428800}}}}';
    const response: unknown = extractWorkspaceResponse(notificationCarrying(json));
    type ReceivedSettings = { policy: { per_user_bytes: unknown }; max_per_user_bytes: unknown };
    const settings: ReceivedSettings = (response as { Telemetry: { Settings: ReceivedSettings } }).Telemetry.Settings;
    expect(settings.policy.per_user_bytes).toBe(20971520n);
    expect(settings.max_per_user_bytes).toBe(52428800n);
  });

  it('keeps every digit of a u64 above 2^53', () => {
    const json: string = '{"Response":{"Telemetry":{"Settings":{"policy":{"retention_days":30,"per_user_bytes":1},"max_per_user_bytes":18446744073709551615}}}}';
    const response: unknown = extractWorkspaceResponse(notificationCarrying(json));
    expect((response as { Telemetry: { Settings: { max_per_user_bytes: unknown } } }).Telemetry.Settings.max_per_user_bytes).toBe(18446744073709551615n);
  });
});
