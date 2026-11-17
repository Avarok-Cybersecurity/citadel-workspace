/**
 * A `Consent` answer the UI never asked for -- the agent's own GetMyConsent -- goes through the
 * production response handler: it is handled without error, with no request pending, and it
 * reaches the screens that follow consent. Nothing is mocked but the console, to see it stays quiet.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { MyConsent, WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import { handleGeneratedVariants } from '@/lib/workspace-response-handler/generated-variant-handlers';
import { buildConnectionInfo } from '@/lib/workspace-response-handler/workspace-handlers';
import { onServerConsent } from '../consent-feed';

const CONSENT: MyConsent = {
  accepted_platform_version: 1, accepted_workspace_version: null, required_platform_version: 1,
  required_workspace_version: null, terms_current: true, telemetry_enabled: true, uploads_allowed: true,
};
const volunteer = (): boolean => handleGeneratedVariants({ Telemetry: { Consent: CONSENT } } as WorkspaceProtocolResponse, buildConnectionInfo());

afterEach(() => { vi.restoreAllMocks(); });

describe('a volunteered consent answer', () => {
  it('is handled quietly with no request pending', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(volunteer()).toBe(true);
    expect(errors).not.toHaveBeenCalled();
  });

  it('reaches whoever follows consent, once each, and not after they stop', () => {
    const heard: MyConsent[] = [];
    const stop: () => void = onServerConsent((c: MyConsent): void => { heard.push(c); });
    volunteer();
    expect(heard).toEqual([CONSENT]);
    stop();
    volunteer();
    expect(heard).toHaveLength(1);
  });

  it('is not announced for answers of another kind', () => {
    const heard: MyConsent[] = [];
    const stop: () => void = onServerConsent((c: MyConsent): void => { heard.push(c); });
    handleGeneratedVariants({ Telemetry: { Deleted: { segments: 1 } } } as WorkspaceProtocolResponse, buildConnectionInfo());
    stop();
    expect(heard).toEqual([]);
  });
});
