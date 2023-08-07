import { MutationHook } from '@common/types/hooks';
import { useDisconnect_c2s } from '@common/c2s';
import { ServiceConnectionAccepted } from '@common/types/c2s';
import { UseDisconnect } from '@common/c2s/useDisconnect_c2s';

export default useDisconnect_c2s as UseDisconnect<typeof handler>;

export type ConnectHookDescriptor = {
  invokerInput: {
    uuid: string;
    cid: string;
  };
  dataReturn: any;
};

export const handler: MutationHook<ConnectHookDescriptor> = {
  invokerOptions: {
    type: 'disconnect',
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
