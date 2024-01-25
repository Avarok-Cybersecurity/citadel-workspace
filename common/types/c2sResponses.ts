export type Payload = GetSessions | ListAllPeers | Disconnect;

export type ServiceTCPConnectionAccepted = {
  ServiceConnectionAccepted: {
    id: string;
  };
};

export type ServiceRegisterAccepted = {
  ServiceRegisterAccepted: {
    id: string;
    request_id: string;
  };
};

export type ServiceConnectionAccepted = {
  ServiceConnectionAccepted: {
    id: string;
    request_id: string;
  };
};

export type ServiceDisconnect = {
  ServiceDisconnectAccepted: {
    uuid: string;
    request_id: string;
  };
};

export type ListAllPeers = {
  cid: number;
  online_status: { [key: number]: boolean };
  request_id: string;
};
export type PeerSessionInformation = {
  cid: number;
  peer_cid: number;
  peer_username: string;
};

export type Disconnect = {
  cid: number;
  peer_cid: number;
  request_id: string;
};

export type GetSessions = {
  sessions: Array<{
    cid: string;
    peer_connections: { [key: number]: PeerSessionInformation };
  }>;
  request_id: string;
};
