import { addToContext } from 'redux/slices/streamHandler.slice';
import store from 'redux/store';
import invoke from 'hooks/utils/invoke-api';

export type LocalDBClearAllKVInput = {
  cid: string;
  peer_cid?: string;
};

export const useLocalDBClearAllKV = async (
  input: LocalDBClearAllKVInput
): Promise<string> => {
  const response = await invoke<LocalDBClearAllKVInput, string>(
    'local_db_clear_all_kv',
    input
  );
  store.dispatch(
    addToContext({
      req_id: response,
      context_type: 'LocalDBClearAllKV',
    })
  );

  return response;
};

export default useLocalDBClearAllKV;
