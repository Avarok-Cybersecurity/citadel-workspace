import { ApiInvokeTypes, Variables } from '@common/types/api';
import { invoke } from '@tauri-apps/api/core';

const invokeApi = async (type: ApiInvokeTypes, variables: Variables) => {
  try {
    const data = await invoke(type, variables);
    return { data };
  } catch (error: any) {
    throw new Error(error);
  }
};

export default invokeApi;
