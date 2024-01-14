import { MutationHook } from '@common/types/hooks';
import { useHook, useMutationHook } from '@common/utils/useHook';

export type UseDisconnect<H extends MutationHook = MutationHook<any>> =
  ReturnType<H['useHook']>;

const useDisconnect_c2s = () => {
  const hook = useHook((hooks) => hooks.c2s.useDisconnect);
  return useMutationHook({ ...hook })();
};

export default useDisconnect_c2s;
