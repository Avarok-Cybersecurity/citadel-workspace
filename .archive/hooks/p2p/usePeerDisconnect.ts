import { addToContext } from 'redux/slices/streamHandler.slice';
import store from 'redux/store';
import invoke from 'hooks/utils/invoke-api';

export type Peer2PeerDisconnectInput = {
  fullName: string;
  username: string;
  proposedPassword: string;
  serverAddr: string;
};
export const peerDisconnect = async (
  input: Peer2PeerDisconnectInput
): Promise<string> => {
  const response = await invoke<Peer2PeerDisconnectInput, string>(
    'peer_disconnect',
    input
  );
  store.dispatch(
    addToContext({
      req_id: response,
      context_type: 'PeerDisconnect',
    })
  );

  return response;
};

export default peerDisconnect;
