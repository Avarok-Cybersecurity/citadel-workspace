import { addToContext } from 'redux/slices/streamHandler.slice';
import store from 'redux/store';
import invoke from 'hooks/utils/invoke-api';

export type LocalDBSetKVInput = {
  cid: string;
  peer_cid?: string;
  key: string;
  value: Uint8Array; // Assuming you will handle binary data as Uint8Array in JavaScript
};

export const useLocalDBSetKV = async (
  input: LocalDBSetKVInput
): Promise<string> => {
  const response = await invoke<LocalDBSetKVInput, string>(
    'local_db_set_kv',
    input
  );
  store.dispatch(
    addToContext({
      req_id: response,
      context_type: 'LocalDBSetKV',
    })
  );

  return response;
};

export default useLocalDBSetKV;
