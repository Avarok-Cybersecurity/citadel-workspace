import { addToContext } from 'redux/slices/streamHandler.slice';
import store from 'redux/store';
import invoke from 'hooks/utils/invoke-api';

export type LocalDBDeleteKVInput = {
  cid: string;
  peer_cid?: string;
  key: string;
};

export const useLocalDBDeleteKV = async (
  input: LocalDBDeleteKVInput,
): Promise<string> => {
  const response = await invoke<LocalDBDeleteKVInput, string>(
    'local_db_delete_kv',
    input,
  );
  store.dispatch(
    addToContext({
      req_id: response,
      context_type: 'LocalDBDeleteKV',
    }),
  );

  return response;
};

export default useLocalDBDeleteKV;
