/**
 * Encoding a WorkspaceProtocolPayload to bytes and back.
 *
 * Moved verbatim out of workspace-protocol.ts, which holds the protocol's types.
 */
import type { WorkspaceProtocolPayloadTS } from './workspace-protocol';

/**
 * Helper function to create a WorkspaceProtocolPayload with a Message request
 */
export function createMessagePayload(messageContents: Uint8Array): WorkspaceProtocolPayloadTS {
  return {
    Request: {
      Message: {
        contents: messageContents
      }
    }
  };
}

/**
 * Helper function to serialize a WorkspaceProtocolPayload to a Uint8Array
 * 
 * This handles binary data by encoding Uint8Array to base64 strings during serialization
 */
export function serializeWorkspacePayload(payload: WorkspaceProtocolPayloadTS): Uint8Array {
  // Create a deep copy of the payload to avoid modifying the original
  const payloadCopy: unknown = JSON.parse(JSON.stringify(payload, (key, value): unknown => {
    // Special handling for Uint8Array - convert to a special format object
    if (value instanceof Uint8Array) {
      // Convert to base64 for safe JSON serialization
      const base64: string = btoa(String.fromCharCode.apply(null, [...value]));
      return { __type: 'Uint8Array', data: base64 };
    }
    return value;
  }));

  // Convert to string and then to Uint8Array
  const jsonString: string = JSON.stringify(payloadCopy);
  return new TextEncoder().encode(jsonString);
}

/**
 * Helper function to deserialize a Uint8Array to a WorkspaceProtocolPayload
 * 
 * This handles binary data by decoding base64 strings back to Uint8Array during deserialization
 */
export function deserializeWorkspacePayload(data: Uint8Array): WorkspaceProtocolPayloadTS {
  // Convert from Uint8Array to string
  const jsonString: string = new TextDecoder().decode(data);

  // Parse JSON with reviver function to handle special types
  return JSON.parse(jsonString, (key, value) => {
    // Check for our special object format that represents a Uint8Array
    if (value && typeof value === 'object' && value.__type === 'Uint8Array') {
      // Special case for empty arrays (data is '')
      if (value.data === '') {
        return new Uint8Array(0);
      }

      // Convert from base64 back to Uint8Array for non-empty arrays
      const binaryString: string = atob(value.data);
      const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(binaryString.length);
      for (let i: number = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    }
    return value;
  });
}
