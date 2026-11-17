/**
 * Two drops started close together both fitted a quota that only had room for
 * one.
 *
 * `storageUsed` is derived from the tree, and the tree only grows once an upload
 * has LANDED. So a second drop started before the first one's write completes
 * was measured against a total that did not include it — two 60% batches both
 * passing a check against an 80% quota, and the limit exceeded by exactly the
 * amount the user was told there was room for.
 *
 * The window is not small: an upload is a network round trip to the peer or the
 * server, and dropping a second batch while the first is still going is the
 * ordinary way people use a file manager.
 */
import { describe, it, expect } from 'vitest';
import { wouldExceedQuota, remainingQuota } from '../quota-check';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const QUOTA: number = 100;

describe('the upload quota check', () => {
  it('admits a batch that fits', () => {
    expect(wouldExceedQuota({ used: 10, quota: QUOTA, inFlight: 0, incoming: 50 })).toBe(false);
  });

  it('refuses a batch that does not', () => {
    expect(wouldExceedQuota({ used: 60, quota: QUOTA, inFlight: 0, incoming: 50 })).toBe(true);
  });

  it('counts an upload already in the air', () => {
    // The defect, exactly: the first 60 has been started and has not yet
    // reached the tree, so `used` is still 0 and the second 60 looks like it
    // fits.
    expect(
      wouldExceedQuota({ used: 0, quota: QUOTA, inFlight: 60, incoming: 60 }),
      'a second drop was admitted against a total that did not include the first',
    ).toBe(true);
  });

  it('still admits a second batch that genuinely fits alongside the first', () => {
    // The opposite failure: counting in-flight bytes twice, or refusing
    // everything while any upload is running, would make the file manager
    // single-file — and the assertion above cannot see that.
    expect(wouldExceedQuota({ used: 0, quota: QUOTA, inFlight: 60, incoming: 30 })).toBe(false);
  });

  it('reports remaining room without going negative', () => {
    // The banner reads this. A negative number renders as a nonsense figure and
    // would make `incoming > remaining` true for a zero-byte upload.
    expect(remainingQuota({ used: 90, quota: QUOTA, inFlight: 30 })).toBe(0);
    expect(remainingQuota({ used: 10, quota: QUOTA, inFlight: 20 })).toBe(70);
  });
});

/**
 * And the handler has to reserve, and release.
 *
 * The arithmetic above passes whether or not `useDropUpload` keeps an
 * in-flight total at all — the same wiring blindness that has come up in six
 * rounds. There is one drop handler, so this reads it.
 */
describe('the drop handler', () => {
  const SOURCE: string = readFileSync(
    join(process.cwd(), 'src/components/file-manager/useDropUpload.ts'),
    'utf8',
  );

  it('asks the shared check rather than subtracting inline', () => {
    expect(
      SOURCE,
      'the handler went back to `totalSize > storageQuota - storageUsed`, which \
cannot see an upload that has not landed yet',
    ).toContain('wouldExceedQuota(');
    expect(SOURCE).not.toContain('totalSize > storageQuota - storageUsed');
  });

  it('reserves the batch before uploading and releases it in a finally', () => {
    // Without the release, a throw leaks the reservation and every later upload
    // is measured against a quota that shrank permanently.
    expect(SOURCE).toContain('inFlightBytesRef.current += totalSize');
    expect(SOURCE).toContain('inFlightBytesRef.current -= totalSize');

    const reserve: number = SOURCE.indexOf('inFlightBytesRef.current += totalSize');
    const release: number = SOURCE.indexOf('inFlightBytesRef.current -= totalSize');
    const finallyAt: number = SOURCE.lastIndexOf('} finally {', release);
    expect(
      finallyAt > reserve && finallyAt < release,
      'the release is not inside a finally, so a failed upload leaks its reservation',
    ).toBe(true);
  });
});
