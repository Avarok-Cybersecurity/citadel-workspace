import { LosslessNumber } from 'lossless-json';

export type PeerConnectSuccess = {
  cid: LosslessNumber;
  request_id: string;
};

export type PeerDisconnectSuccess = {
  cid: LosslessNumber;
  request_id: string;
};

export type PeerRegisterSuccess = {
  cid: LosslessNumber;
  peer_cid: LosslessNumber;
  peer_username: string;
  request_id: string;
};
