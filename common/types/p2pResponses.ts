export type PeerConnectSuccess = {
  cid: number;
  request_id: string;
};

export type PeerDisconnectSuccess = {
  cid: number;
  request_id: string;
};

export type PeerRegisterSuccess = {
  cid: number;
  peer_cid: number;
  peer_username: string;
  request_id: string;
};
