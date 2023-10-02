import { MutationHook } from '@common/types/hooks';
import { useRegister_c2s } from '@common/c2s';
import { ServiceRegisterAccepted } from '@common/types/c2s';
import { UseRegister } from '@common/c2s/useRegister_c2s';
import store from 'framework/redux/store';
import { addToContext } from 'framework/redux/slices/streamHandler.slice';
import { invoke } from '@tauri-apps/api/tauri';
export default useRegister_c2s as UseRegister<typeof handler>;

export type RegisterHookDescriptor = {
  invokerInput: {
    fullName: string;
    serverAddr: string;
    username: string;
    proposedPassword: string;
  };
  dataReturn: ServiceRegisterAccepted;
};

export const handler: MutationHook<RegisterHookDescriptor> = {
  //// Invoker input is connect because connect_after_register is true in register command
  invokerOptions: {
    type: 'register',
  },
  invoker: async (context) => {
    let { invoke, input, options } = context;

    const { data } = await invoke(options.type, input);

    return data;
  },
  useHook:
    ({ invoke: inv }) =>
    () => {
      return async (input) => {
        const response = await inv(input);
        store.dispatch(
          addToContext({
            req_id: response,
            context_type: 'Register',
          })
        );
        const req_id = await invoke('get_session', {});
        store.dispatch(
          addToContext({
            req_id,
            context_type: 'GetSession',
          })
        );
        return response;
      };
    },
};
