import { MutationHook } from '@common/types/hooks';
import { useRegister_c2s } from '@common/c2s';

export default useRegister_c2s;

export const handler: MutationHook = {
  invokerOptions: {
    type: 'register',
  },
  invoker: async (context) => {
    let { invoke, input, options } = context;
    try {
      const response = await invoke(options.type, input);
      return response;
    } catch (error) {
      throw new Error(error as any);
    }
  },
  useHook: ({ invoke }) => {
    return async (input: any) => {
      const response = await invoke(input);
      return {
        output: response,
      };
    };
  },
};
