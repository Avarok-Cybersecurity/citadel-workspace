import { MutationHook } from '@common/types/hooks';
import useGetAllPeers_c2s, {
  UseGetAllPeers,
} from '@common/c2s/useGetAllPeers_c2s';

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
        return response;
      };
    },
};
