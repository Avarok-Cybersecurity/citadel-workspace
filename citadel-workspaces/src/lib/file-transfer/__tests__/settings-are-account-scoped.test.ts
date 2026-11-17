/**
 * Per-peer file-transfer settings — including "auto-accept incoming files from
 * this peer" — were keyed by the PEER's CID alone. This browser holds several
 * sessions at once, so one account enabling auto-accept for peer X made every
 * other account in the same browser auto-accept from X: a security setting
 * inherited by an account that never agreed to it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const cidRef: { current: bigint | null; } = { current: null as bigint | null };
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { get cid(): bigint | null { return cidRef.current; } }) };
});

import { fileTransferService } from '../service';

const PEER: string = '999';

describe('file-transfer settings', () => {
  beforeEach(() => { cidRef.current = null; });

  it('does not leak one account\'s auto-accept to another in the same browser', async () => {
    cidRef.current = 111n;
    await fileTransferService.setAutoAccept(PEER, true);
    expect(fileTransferService.getAutoAccept(PEER)).toBe(true);

    // Same browser, same peer, different account.
    cidRef.current = 222n;

    expect(
      fileTransferService.getAutoAccept(PEER),
      'account 222 inherited account 111\'s auto-accept for this peer',
    ).toBe(false);
  });

  it('keeps each account\'s own choice', async () => {
    cidRef.current = 111n;
    await fileTransferService.setAutoAccept(PEER, true);

    cidRef.current = 222n;
    await fileTransferService.setAutoAccept(PEER, false);

    cidRef.current = 111n;
    expect(fileTransferService.getAutoAccept(PEER)).toBe(true);
  });
});
