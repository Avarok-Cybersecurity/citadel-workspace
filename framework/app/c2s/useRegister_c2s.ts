import { MutationHook } from '@common/types/hooks';
import { useRegister_c2s } from '@common/c2s';

export default useRegister_c2s;

export const handler: MutationHook = {
  invokerOptions: {
    type: "connect_c2s"
  },
  invoker: async (context) => {
    let { invoke, input, options} = context;

    const response = await invoke({...options});
    return response;
  },
  useHook: ({ invoke }) => {
    return async (input: any) => {
      const response = invoke(input);
      return {
        output: response,
      };
    };
  },
};
