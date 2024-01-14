import { MutationHook } from '@common/types/hooks';
import { useRegister_c2s } from '@common/c2s';
import { UseRegister } from '@common/c2s/useRegister_c2s';
import store from 'framework/redux/store';
import { addToContext } from 'framework/redux/slices/streamHandler.slice';
import { invoke } from '@tauri-apps/api/core';
export default useRegister_c2s as UseRegister<typeof handler>;

export type UseGetAccountInfoHookDescriptor = {
  invokerInput: {
    uuid: string;
    cid?: string;
  };
  dataReturn: any;
};

export const handler: MutationHook<UseGetAccountInfoHookDescriptor> = {
  //// Invoker input is connect because connect_after_register is true in register command
  invokerOptions: {
    type: 'getAccInfo',
  },
  invoker: async (context) => {
    let { invoke, input, options } = context;

    const { data } = await invoke(options.type, input);

    return data;
  },
  useHook:
    ({ invoke }) =>
    () => {
      return async (input) => {
        const response = await invoke(input);
        store.dispatch(
          addToContext({
            req_id: response,
            context_type: 'getAccInfo',
          })
        );

        return response;
      };
    },
};
