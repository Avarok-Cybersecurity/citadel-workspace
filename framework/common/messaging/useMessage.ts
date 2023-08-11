import { MutationHook } from '@common/types/hooks';
import { useHook, useMutationHook } from '@common/utils/useHook';

export type UseMessage<H extends MutationHook = MutationHook<any>> = ReturnType<
  H['useHook']
>;

const useMessage: UseMessage = () => {
  const hook = useHook((hooks) => hooks.useMessage);
  return useMutationHook({ ...hook })();
};

export default useMessage;
