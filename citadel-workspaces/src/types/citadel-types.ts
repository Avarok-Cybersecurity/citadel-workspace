// Re-export crypto/protocol types from the canonical source (SSOT)
// These types are auto-generated from Rust enums via ts-rs in @avarok/citadel-protocol-types
export type {
  SecurityLevel,
  SecrecyMode,
  EncryptionAlgorithm,
  KemAlgorithm,
  SigAlgorithm,
  UdpMode,
} from '@avarok/citadel-protocol-types';

// ConnectMode is locally defined as a simple enum for UI usage.
// The canonical ConnectMode is a tagged union with force_login field,
// which is handled at the protocol layer.
export enum ConnectMode {
  Fetch = "Fetch",
  Standard = "Standard"
}

export function stringToUint8Array(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}
