import { LosslessNumber } from 'lossless-json';

export type Payload = {
  payload: GetSessions | ListAllPeers | Disconnect;
  error: boolean;
};

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
  cid: LosslessNumber;
  online_status: { [key: string]: boolean };
  request_id: string;
};
export type PeerSessionInformation = {
  cid: bigint;
  peer_cid: bigint;
  peer_username: string;
};

export type Disconnect = {
  cid: bigint;
  peer_cid: bigint;
  request_id: string;
};

export type GetSessions = {
  sessions: Array<{
    cid: string;
    peer_connections: { [key: string]: PeerSessionInformation };
  }>;
  request_id: string;
};
