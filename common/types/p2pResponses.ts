export type PeerConnectSuccess = {
  cid: bigint;
  request_id: string;
};

export type PeerDisconnectSuccess = {
  cid: bigint;
  request_id: string;
};

export type PeerRegisterSuccess = {
  cid: bigint;
  peer_cid: bigint;
  peer_username: string;
  request_id: string;
};
