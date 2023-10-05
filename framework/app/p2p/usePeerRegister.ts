import { MutationHook } from '@common/types/hooks';
import store from 'framework/redux/store';
import { addToContext } from 'framework/redux/slices/streamHandler.slice';
import { invoke } from '@tauri-apps/api/tauri';
import { useP2PRegister } from '@common/p2p';
import { UsePRegister } from '@common/p2p/usePeerRegister';
export default useP2PRegister as UsePRegister<typeof handler>;

export type UsePeerRegister = {
  invokerInput: {
    myCid: string;
    peerCid: string;
  };
  dataReturn: any;
};

export const handler: MutationHook<UsePeerRegister> = {
  invokerOptions: {
    type: 'peer_register',
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
            context_type: 'peerRegister',
          })
        );

        return response;
      };
    },
};
