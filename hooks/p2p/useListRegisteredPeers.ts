import { addToContext } from 'redux/slices/streamHandler.slice';
import store from 'redux/store';
import invoke from 'hooks/utils/invoke-api';

export type ListRegisteredPeersInput = {
  cid: string;
};
export const useListRegisteredPeers = async (
  input: ListRegisteredPeersInput
): Promise<string> => {
  const response = await invoke<ListRegisteredPeersInput, string>(
    'list_registered_peers',
    input
  );
  store.dispatch(
    addToContext({
      req_id: response,
      context_type: 'ListRegisteredPeers',
    })
  );

  return response;
};

export default useListRegisteredPeers;
