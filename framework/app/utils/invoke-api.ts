import { ApiInvokeTypes, Variables } from '@common/types/api';
import { invoke } from '@tauri-apps/api/tauri';

const invokeApi = async <T>(type: ApiInvokeTypes, variables: Variables) => {
  try {
    const data = await invoke(type, variables);
    return { data };
  } catch (error: any) {
    throw new Error(error);
  }
};

export default invokeApi;
