/**
 * GetServerCapabilities' reason for storing no files reaches the file manager as the kernel sent
 * it: each ServerFeatureRefusal variant unchanged, and an absent one (undefined from
 * serde-wasm-bindgen, a server older than the field) as null. Real handler and event emitter;
 * nothing doubled.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerFeatureRefusal, WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import type { ServerCapabilities } from '@/hooks/useRevfsTree-types';
import { handleGeneratedVariants } from '../generated-variant-handlers';

const heard: ServerCapabilities[] = [];
const listen = (caps: ServerCapabilities): void => { heard.push(caps); };
afterEach((): void => { eventEmitter.off('server:capabilities:loaded', listen); heard.length = 0; });

function answered(refusal: ServerFeatureRefusal | undefined): ServerCapabilities {
  eventEmitter.on('server:capabilities:loaded', listen);
  const response: WorkspaceProtocolResponse = { ServerCapabilities: {
    allow_server_file_transfer: false, allow_server_revfs_storage: false, max_file_transfer_size_mb: 100n, revfs_storage_quota_mb: 100n,
    ...(refusal === undefined ? {} : { revfs_storage_refusal: refusal }),
  } } as WorkspaceProtocolResponse;
  expect(handleGeneratedVariants(response, { cid: 0, request_id: 'r' })).toBe(true);
  expect(heard).toHaveLength(1);
  return heard[0];
}

describe('the server\'s reason for storing no files', () => {
  it.each<ServerFeatureRefusal>(['DisabledByConfig', 'NoBackend', { BackendCannotStoreStreamedObjects: { backend: 'InMemory' } }])('arrives as sent: %j', (refusal: ServerFeatureRefusal) => {
    expect(answered(refusal).revfsStorageRefusal).toEqual(refusal);
  });

  it('is null when the server gave none', () => {
    expect(answered(undefined).revfsStorageRefusal).toBeNull();
  });
});
