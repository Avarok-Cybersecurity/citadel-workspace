import { MutationHook } from '@common/types/hooks';
import { useHook, useMutationHook } from '@common/utils/useHook';

export type UseGetAllPeers<H extends MutationHook = MutationHook<any>> =
  ReturnType<H['useHook']>;

const useGetAllPeers_c2s: UseGetAllPeers = () => {
  const hook = useHook((hooks) => hooks.c2s.useGetAllPeers);
  return useMutationHook({ ...hook })();
};

export default useGetAllPeers_c2s;
