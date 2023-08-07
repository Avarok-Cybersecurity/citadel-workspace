import { MutationHook } from '@common/types/hooks';
import { useHook, useMutationHook } from '@common/utils/useHook';

export type UseGetSession<H extends MutationHook = MutationHook<any>> =
  ReturnType<H['useHook']>;

const useGetSession_c2s: UseGetSession = () => {
  const hook = useHook((hooks) => hooks.c2s.useGetSession);
  return useMutationHook({ ...hook })();
};

export default useGetSession_c2s;
