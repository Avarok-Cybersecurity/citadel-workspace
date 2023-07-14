import invokeApi from '../utils/invoke-api';
import { useRegister_c2s } from '@common/c2s';

export default useRegister_c2s;

export const handler = {
  invoker: () => {
    console.log('Invoked');
  },
  useHook: () => {
    return (input: any) => {
      return {
        output: input + '_MODIf',
      };
    };
  },
};
