import { useHook, useMutationHook } from '@common/utils/useHook';

const useRegister_c2s = () => {
  const hook = useHook((hooks) => hooks.c2s.useRegister);
  return useMutationHook({ ...hook });
};

export default useRegister_c2s;
