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

export function stringToUint8Array(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}
