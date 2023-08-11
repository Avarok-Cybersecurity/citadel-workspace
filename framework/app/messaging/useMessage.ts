import { MutationHook } from '@common/types/hooks';
import { ServiceConnectionAccepted } from '@common/types/c2s';
import useMessage, { UseMessage } from '@common/messaging/useMessage';

export default useMessage as UseMessage<typeof handler>;

export type MessageHookDescriptor = {
  invokerInput: {
    uuid: string;
    cid: bigint;
    message: string;
    peerCid?: bigint;
  };
  dataReturn: any;
};

export const handler: MutationHook<MessageHookDescriptor> = {
  invokerOptions: {
    type: 'message',
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
