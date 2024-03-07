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
  | 'list_registered_peers';

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
