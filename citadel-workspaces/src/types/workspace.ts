export interface WorkspaceConfig {
  // Connection details
  serverAddress: string;
  password?: string;
  
  // Security settings
  securityLevel: string;
  securityMode: string;
  
  // Advanced settings
  encryptionAlgorithm: string;
  kemAlgorithm: string;
  signingAlgorithm: string;
  headerObfuscatorMode: string;
  psk?: string;
  
  // Profile details
  fullName: string;
  username: string;
  profilePassword: string;
}