import { MutationHook } from '@common/types/hooks';
import { useRegister_c2s } from '@common/c2s';
import { ServiceRegisterAccepted } from '@common/types/c2s';

export default useRegister_c2s;

export const handler: MutationHook<RegisterHookDescriptor> = {
  invokerOptions: {
    type: 'register',
  },
  invoker: async (context) => {
    let { invoke, input, options } = context;

    const response = await invoke(options.type, input);
    return response;
  },
  useHook: ({ invoke }) => {
    return async (input) => {
      const response = await invoke(input);
      return response;
    };
  },
};

export interface RegisterInput {
  uuid: string;
  fullName: string;
  username: string;
  proposedPassword: string;
}

export type RegisterHookDescriptor = {
  invokerInput: RegisterInput;
  dataReturn: ServiceRegisterAccepted;
};
