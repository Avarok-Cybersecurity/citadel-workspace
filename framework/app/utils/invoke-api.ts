import { ApiInvokerOptions, ApiInvokerResults } from '@common/types/api';
import { invoke } from '@tauri-apps/api/tauri';

const invokeApi = async <T>({ type, variables }: ApiInvokerOptions) => {
  try {
    await invoke(type, variables);
  } catch (error: any) {
    throw new Error(error[0].message ?? error.message);
  }
};

export default invokeApi;
