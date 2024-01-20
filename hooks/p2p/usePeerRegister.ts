import { addToContext } from 'redux/slices/streamHandler.slice';
import store from 'redux/store';
import invoke from 'hooks/utils/invoke-api';

export type Peer2PeerRegisterInput = {
  fullName: string;
  username: string;
  proposedPassword: string;
  serverAddr: string;
};
export const peerRegister = async (
  input: Peer2PeerRegisterInput
): Promise<string> => {
  const response = await invoke<Peer2PeerRegisterInput, string>(
    'peer_register',
    input
  );
  store.dispatch(
    addToContext({
      req_id: response,
      context_type: 'PeerRegister',
    })
  );

  return response;
};

export default peerRegister;
