import {
  ApiInvokerOptions,
  ApiInvokeTypes,
  Variables,
} from '@common/types/api';
import { invoke } from '@tauri-apps/api/tauri';

const invokeApi = async (type: ApiInvokeTypes, variables: Variables) => {
  console.log('invokeApi types and variables', type, variables);
  try {
    const data = await invoke(type, variables);
    return data;
  } catch (error: any) {
    throw new Error(error);
  }
};

export default invokeApi;
