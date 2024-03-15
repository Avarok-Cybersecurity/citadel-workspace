import { addToContext } from 'redux/slices/streamHandler.slice';
import store from 'redux/store';
import invoke from 'hooks/utils/invoke-api';

export type LocalDBGetAllKVInput = {
  cid: string;
  peer_cid?: string;
};

export const useLocalDBGetAllKV = async (
  input: LocalDBGetAllKVInput
): Promise<string> => {
  const response = await invoke<LocalDBGetAllKVInput, string>(
    'local_db_get_all_kv',
    input
  );
  store.dispatch(
    addToContext({
      req_id: response,
      context_type: 'LocalDBGetAllKV',
    })
  );

  return response;
};

export default useLocalDBGetAllKV;
