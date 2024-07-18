import { addToContext } from 'redux/slices/streamHandler.slice';
import store from 'redux/store';
import invoke from 'hooks/utils/invoke-api';

export type ListAllPeersInput = {
  cid: string;
};
export const listAllPeers = async (
  input: ListAllPeersInput,
): Promise<string> => {
  const response = await invoke<ListAllPeersInput, string>(
    'list_all_peers',
    input,
  );
  store.dispatch(
    addToContext({
      req_id: response,
      context_type: 'ListAllPeers',
    }),
  );

  return response;
};

export default listAllPeers;
