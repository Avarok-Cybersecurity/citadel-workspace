import { ApiInvokeTypes, Variables } from '@common/types/api';
import { invoke } from '@tauri-apps/api/tauri';

const invokeApi = async (type: ApiInvokeTypes, variables: Variables) => {
  try {
    console.log('Type of the command', type);
    const data = await invoke(type, variables);
    return { data };
  } catch (error: any) {
    console.log(error);
    throw new Error(error);
  }
};

export default invokeApi;
