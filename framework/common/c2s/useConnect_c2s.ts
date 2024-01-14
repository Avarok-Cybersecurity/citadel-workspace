import { MutationHook } from '@common/types/hooks';
import { useHook, useMutationHook } from '@common/utils/useHook';

export type UseConnect<H extends MutationHook = MutationHook<any>> = ReturnType<
  H['useHook']
>;

const useConnect_c2s: UseConnect = () => {
  const hook = useHook((hooks) => hooks.c2s.useConnect);
  return useMutationHook({ ...hook })();
};

export default useConnect_c2s;
