import { MutationHook } from '@common/types/hooks';
import { useConnect_c2s } from '@common/c2s';
import { ServiceConnectionAccepted } from '@common/types/c2s';
import { UseConnect } from '@common/c2s/useConnect_c2s';

export default useConnect_c2s as UseConnect<typeof handler>;

export type ConnectHookDescriptor = {
  invokerInput: {
    uuid: string;
    fullName: string;
    serverAddr: string;
    username: string;
    proposedPassword: string;
  };
  dataReturn: ServiceConnectionAccepted;
};

export const handler: MutationHook<ConnectHookDescriptor> = {
  invokerOptions: {
    type: 'connect',
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
