import { MutationHook } from '@common/types/hooks';
import { useHook, useMutationHook } from '@common/utils/useHook';

export type UsePRegister<H extends MutationHook = MutationHook<any>> =
  ReturnType<H['useHook']>;

const useP2pRegister: UsePRegister = () => {
  const hook = useHook((hooks) => hooks.p2p.useRegister);
  return useMutationHook({ ...hook })();
};

export default useP2pRegister;
