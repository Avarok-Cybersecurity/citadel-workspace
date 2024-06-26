import { invoke } from '@tauri-apps/api/core';

export type ApiInvokeTypes =
  | 'message'
  | 'register'
  | 'connect'
  | 'disconnect'
  | 'get_sessions'
  | 'list_all_peers'
  | 'peer_connect'
  | 'peer_disconnect'
  | 'peer_register'
  | 'list_registered_peers'
  | 'local_db_get_kv'
  | 'local_db_get_all_kv'
  | 'local_db_set_kv'
  | 'local_db_delete_kv'
  | 'local_db_clear_all_kv';

const invokeApi = async <T = any, R = string>(
  type: ApiInvokeTypes,
  variables?: T
): Promise<R> => {
  try {
    if (!variables) {
      const data: R = await invoke(type);
      return data;
    }

    const data: R = await invoke(type, variables!);
    return data;
  } catch (error: any) {
    throw new Error(error);
  }
};

export default invokeApi;
