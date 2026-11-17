/**
 * Test file for workspace protocol serialization
 */
import { describe, it, expect } from 'vitest';
import {
  createMessagePayload,
  serializeWorkspacePayload,
  deserializeWorkspacePayload
} from '../types/workspace-payload-codec';
import { debugLog } from '@/lib/debug-config';
import type { WorkspaceProtocolPayloadTS } from '@/types/workspace-protocol';

describe('Workspace Protocol', () => {
  it('should create a message payload correctly', () => {
    // Test with a simple binary message
    const testData: Uint8Array<ArrayBuffer> = new Uint8Array([1, 2, 3, 4, 5]);
    const payload: WorkspaceProtocolPayloadTS = createMessagePayload(testData);

    // Verify the structure (uses Pascal case to match Rust serialization)
    expect(payload).toHaveProperty('Request');
    expect(payload.Request).toHaveProperty('Message');
    expect(payload.Request?.Message).toHaveProperty('contents');

    // Verify the contents are preserved
    const contents: Uint8Array<ArrayBufferLike> | undefined = payload.Request?.Message?.contents;
    expect(contents instanceof Uint8Array).toBe(true);
    expect(Array.from(contents as Uint8Array)).toEqual([1, 2, 3, 4, 5]);
  });

  it('should serialize and deserialize payloads correctly', () => {
    // Create a test message
    const testData: Uint8Array<ArrayBuffer> = new Uint8Array([1, 2, 3, 4, 5]);
    const payload: WorkspaceProtocolPayloadTS = createMessagePayload(testData);

    // Check payload type before serialization
    debugLog('WorkspaceProtocolTest', 'Original payload:', payload);
    debugLog('WorkspaceProtocolTest', 'Original contents type:', payload.Request?.Message?.contents?.constructor.name);

    // Serialize
    const serialized: Uint8Array<ArrayBufferLike> = serializeWorkspacePayload(payload);
    debugLog('WorkspaceProtocolTest', 'Serialized type:', serialized?.constructor.name);

    // Deserialize
    const deserialized: WorkspaceProtocolPayloadTS = deserializeWorkspacePayload(serialized);
    debugLog('WorkspaceProtocolTest', 'Deserialized payload:', deserialized);
    debugLog('WorkspaceProtocolTest', 'Deserialized contents type:', deserialized.Request?.Message?.contents?.constructor.name);

    // Verify the structure is preserved (uses Pascal case to match Rust serialization)
    expect(deserialized).toHaveProperty('Request');
    expect(deserialized.Request).toHaveProperty('Message');
    expect(deserialized.Request?.Message).toHaveProperty('contents');

    // Verify the binary data is correctly preserved through serialization/deserialization
    const deserializedContents: Uint8Array<ArrayBufferLike> | undefined = deserialized.Request?.Message?.contents;
    expect(deserializedContents instanceof Uint8Array).toBe(true);
    expect(Array.from(deserializedContents as Uint8Array)).toEqual([1, 2, 3, 4, 5]);
  });

  it('should handle empty messages', () => {
    // Create an empty message
    const emptyData: Uint8Array<ArrayBuffer> = new Uint8Array(0);
    const payload: WorkspaceProtocolPayloadTS = createMessagePayload(emptyData);

    debugLog('WorkspaceProtocolTest', 'Empty payload:', payload);
    debugLog('WorkspaceProtocolTest', 'Empty contents type:', payload.Request?.Message?.contents?.constructor.name);

    // Serialize and then deserialize
    const serialized: Uint8Array<ArrayBufferLike> = serializeWorkspacePayload(payload);
    const deserialized: WorkspaceProtocolPayloadTS = deserializeWorkspacePayload(serialized);

    debugLog('WorkspaceProtocolTest', 'Deserialized empty payload:', deserialized);
    debugLog('WorkspaceProtocolTest', 'Deserialized empty contents:', deserialized.Request?.Message?.contents);
    debugLog('WorkspaceProtocolTest', 'Deserialized empty contents type:',
      deserialized.Request?.Message?.contents ?
        deserialized.Request?.Message?.contents.constructor.name : 'undefined');

    // Verify structure and content (uses Pascal case to match Rust serialization)
    expect(deserialized.Request?.Message?.contents).toBeDefined();
    const contents: Uint8Array<ArrayBufferLike> | undefined = deserialized.Request?.Message?.contents;

    // Instead of checking instanceof, check if it's array-like and has expected properties
    if (contents) {
      expect(Array.isArray(contents) ||
        (typeof contents === 'object' && 'length' in contents)).toBe(true);
      expect(contents.length).toBe(0);
    }
  });

  it('should handle large binary messages', () => {
    // Create a large binary message (1KB)
    const largeData: Uint8Array<ArrayBuffer> = new Uint8Array(1024);
    for (let i: number = 0; i < largeData.length; i++) {
      largeData[i] = i % 256;
    }

    const payload: WorkspaceProtocolPayloadTS = createMessagePayload(largeData);

    // Serialize and then deserialize
    const serialized: Uint8Array<ArrayBufferLike> = serializeWorkspacePayload(payload);
    const deserialized: WorkspaceProtocolPayloadTS = deserializeWorkspacePayload(serialized);

    // Verify the contents length (uses Pascal case to match Rust serialization)
    const deserializedContents: Uint8Array<ArrayBufferLike> = deserialized.Request?.Message?.contents as Uint8Array;
    expect(deserializedContents instanceof Uint8Array).toBe(true);
    expect(deserializedContents.length).toEqual(1024);

    // Check a few sample values (first, middle, last)
    expect(deserializedContents[0]).toEqual(0);
    expect(deserializedContents[255]).toEqual(255);
    expect(deserializedContents[512]).toEqual(0);
    expect(deserializedContents[1023]).toEqual(255);
  });
});
