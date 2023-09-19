import { MutationHook } from '@common/types/hooks';
import useGetAllPeers_c2s, {
  UseGetAllPeers,
} from '@common/c2s/useGetAllPeers_c2s';
import store from 'framework/redux/store';
import { addToContext } from 'framework/redux/slices/streamHandler.slice';

export default useGetAllPeers_c2s as UseGetAllPeers<typeof handler>;

export type GetAllPeersHookDescriptor = {
  invokerInput: {
    uuid: string;
    cid: number;
  };
  dataReturn: unknown;
};

export const handler: MutationHook<GetAllPeersHookDescriptor> = {
  invokerOptions: {
    type: 'get_all_peers',
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
            context_type: 'getAllPeers',
          })
        );
        return response;
      };
    },
};
