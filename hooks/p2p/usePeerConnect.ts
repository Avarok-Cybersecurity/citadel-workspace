import { addToContext } from 'redux/slices/streamHandler.slice';
import store from 'redux/store';
import invoke from 'hooks/utils/invoke-api';

export type Peer2PeerConnectInput = {
  fullName: string;
  username: string;
  proposedPassword: string;
  serverAddr: string;
};
export const peerConnect = async (
  input: Peer2PeerConnectInput
): Promise<string> => {
  const response = await invoke<Peer2PeerConnectInput, string>(
    'peer_connect',
    input
  );
  store.dispatch(
    addToContext({
      req_id: response,
      context_type: 'PeerConnect',
    })
  );

  return response;
};

export default peerConnect;
