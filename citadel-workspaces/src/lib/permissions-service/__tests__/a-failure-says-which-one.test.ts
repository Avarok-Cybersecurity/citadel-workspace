/**
 * Three failures, one silence.
 *
 * `fetchPermissions` can fail three ways that mean quite different things:
 * nobody is signed in on this tab, the request went out and no answer came, or
 * it threw on the way. It returned `null` for the first and rejected for the
 * others, and everything above it collapsed all three into "not allowed" — so a
 * disabled control could not say which, and neither could CI.
 *
 * Four rounds were spent narrowing this by adding one more sentence at a time to
 * a disabled button's title: round 289 put the reason in the DOM at all, 294
 * found the CID was printing as `undefined`, 298 separated "unanswered" from
 * "denied", 300 fixed a partial write that erased the identity. The service
 * knows which branch it took at the moment it takes it. It records it now.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { permissionsService } from '../index';

vi.mock('@/lib/workspace-service', () => ({
  default: { getUserPermissions: (): Promise<void> => Promise.resolve() },
}));

const NO_DOMAIN: 'office-nobody-asked-about' = 'office-nobody-asked-about';

beforeEach((): void => { vi.restoreAllMocks(); });
afterEach((): void => { vi.restoreAllMocks(); });

describe('getLastFailure', () => {
  it('says nothing about a domain nobody has asked about', () => {
    expect(permissionsService.getLastFailure(NO_DOMAIN)).toBeNull();
  });

  it('names the signed-out case rather than reporting a denial', async (): Promise<void> => {
    // `resolveCurrentUserId` returns null when neither the connection nor the
    // tab-selected session knows who this is. The caller saw `null` and could
    // not tell that from "the server said no".
    const service: { resolveCurrentUserId: () => Promise<string | null> } =
      permissionsService as unknown as { resolveCurrentUserId: () => Promise<string | null> };
    vi.spyOn(service, 'resolveCurrentUserId').mockResolvedValue(null);

    const result: unknown = await permissionsService.fetchPermissions('office-1');

    expect(result).toBeNull();
    expect(permissionsService.getLastFailure('office-1')).toContain('signed in');
  });
});
