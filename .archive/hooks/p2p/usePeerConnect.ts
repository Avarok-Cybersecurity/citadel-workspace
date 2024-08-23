import { addToContext } from 'redux/slices/streamHandler.slice';
import store from 'redux/store';
import invoke from 'hooks/utils/invoke-api';

export type Peer2PeerConnectInput = {
  cid: string;
  peerCid: string;
};
export const usePeerConnect = async (
  input: Peer2PeerConnectInput,
): Promise<string> => {
  const response = await invoke<Peer2PeerConnectInput, string>(
    'peer_connect',
    input,
  );
  console.log('peer_connect response', response);
  store.dispatch(
    addToContext({
      req_id: response,
      context_type: 'PeerConnectNotification',
    }),
  );

  return response;
};

export default usePeerConnect;
