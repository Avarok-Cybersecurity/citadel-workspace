export const secrecyOptions = [
  { label: "Best Effort", value: 0 },
  { label: "Perfect Forward Secrecy", value: 1 },
];
export const securityLevels = [
  { label: "Standard", value: 0 },
  { label: "Reinforced", value: 127 },
  { label: "High", value: 255 },
];
export const sigOptions = [
  { label: "None", value: 0 },
  { label: "Falcon1024", value: 1 },
];
export const encryptionOptions = [
  { label: "AES_GCM_256", value: 0 },
  { label: "ChaCha20Poly_1305", value: 1 },
  { label: "Kyber", value: 2 },
  { label: "Ascon80pq", value: 3 },
];
export const kemOptions = [
  { label: "Kyber", value: 0 },
  { label: "Ntru", value: 1 },
];

export interface RegistrationRequest {
  workspaceIdentifier: string | null;
  workspacePassword: string | null;
  securityLevel: number | null;
  securityMode: number | null;
  encryptionAlgorithm: number | null;
  kemAlgorithm: number | null;
  sigAlgorithm: number | null;
  fullName: string | null;
  username: string | null;
  profilePassword: string | null;
}
