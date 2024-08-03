export interface WorkspaceInfo {
  iconPath: string;
  name: string;
}

export interface ListKnownServersRequest{
  cid: string;
}

export interface ListKnownServersResponse {
  servers: RegistrationInfo[]
}

export interface ConnectRequest{
    registrationInfo: RegistrationInfo
}

export interface ConnectResponse{
    cid: string|null,
    success: boolean,
    message: string
}

export interface ListAllPeersRequest{
  cid: string
}

export interface ListAllPeersResponse{
  peers: Record<string, PeerInformation> | null,
  success: boolean,
  message: string
}


export interface RegistrationInfo {
    server_address: string,
    server_password: string|null,
    security_level: number,
    security_mode: number,
    encryption_algorithm: number,
    kem_algorithm: number,
    sig_algorithm: number,
    full_name: string,
    username: string,
    profile_password: string,
}

export interface PeerInformation {
    cid: number,
    online_status: boolean,
    name: string|null,
    username: string|null,
}