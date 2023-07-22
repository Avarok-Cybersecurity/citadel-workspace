import { useHook, useMutationHook } from '@common/utils/useHook';

const useConnect_c2s = () => {
  const hook = useHook((hooks) => hooks.c2s.useRegister);
  return useMutationHook({ ...hook });
};

export default useConnect_c2s;
