import { addToContext } from 'redux/slices/streamHandler.slice';
import store from 'redux/store';
import invoke from 'hooks/utils/invoke-api';

export type MessageInput = {
  cid: string;
  message: string;
  peerCid?: string;
};
export default async function useSendMessage(
  input: MessageInput
): Promise<string> {
  const response = await invoke<{ cid: string }, string>('message', input);

  if (input.peerCid) {
    store.dispatch(
      addToContext({
        req_id: response,
        context_type: 'PeerMessage',
      })
    );
    return response;
  } else {
    store.dispatch(
      addToContext({
        req_id: response,
        context_type: 'ServerMessage',
      })
    );

    return response;
  }
}
