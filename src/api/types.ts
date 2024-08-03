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