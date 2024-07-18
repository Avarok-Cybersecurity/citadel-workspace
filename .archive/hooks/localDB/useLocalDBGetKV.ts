import { addToContext } from 'redux/slices/streamHandler.slice';
import store from 'redux/store';
import invoke from 'hooks/utils/invoke-api';

export type LocalDBGetKVInput = {
  cid: string;
  peer_cid?: string;
  key: string;
};

export const useLocalDBGetKV = async (
  input: LocalDBGetKVInput,
): Promise<string> => {
  const response = await invoke<LocalDBGetKVInput, string>(
    'local_db_get_kv',
    input,
  );
  store.dispatch(
    addToContext({
      req_id: response,
      context_type: 'LocalDBGetKV',
    }),
  );

  return response;
};

export default useLocalDBGetKV;
