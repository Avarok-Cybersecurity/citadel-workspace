import { MutationHook } from '@common/types/hooks';
import { useRegister_c2s } from '@common/c2s';

export default useRegister_c2s;

export const handler: MutationHook = {
  invoker: (input: any) => {
    console.log('Invoked');
    return JSON.stringify(input) + '_Modified';
  },
  useHook: ({ invoke }) => {
    return (input: any) => {
      const response = invoke(input);
      return {
        output: response,
      };
    };
  },
};
