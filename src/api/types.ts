export interface WorkspaceInfo {
  iconPath: string;
  name: string;
}

export interface ListKnownServersRequest{
  cid: string;
}

export interface ListKnownServersResponse {
  addresses: string[]
}