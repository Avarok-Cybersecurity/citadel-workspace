import { MutationHook } from '@common/types/hooks';
import { useHook, useMutationHook } from '@common/utils/useHook';

export type UseRegister<H extends MutationHook = MutationHook<any>> =
  ReturnType<H['useHook']>;

const useRegister_c2s: UseRegister = () => {
  const hook = useHook((hooks) => hooks.c2s.useRegister);
  return useMutationHook({ ...hook })();
};

export default useRegister_c2s;
