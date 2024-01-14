import { MutationHook } from '@common/types/hooks';
import { useHook, useMutationHook } from '@common/utils/useHook';

export type UseGetAccountinfo<H extends MutationHook = MutationHook<any>> =
  ReturnType<H['useHook']>;

const useRegister_c2s: UseGetAccountinfo = () => {
  const hook = useHook((hooks) => hooks.c2s.useGetAccountInfo);
  return useMutationHook({ ...hook })();
};

export default useRegister_c2s;
