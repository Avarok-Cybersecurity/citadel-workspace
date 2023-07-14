import { useHook } from '@common/utils/useHook';

const useRegister_c2s = () => {
  const hook = useHook((hooks) => hooks.c2s.useRegister);

  return hook.useHook({ invoke: hook.invoker });
};

export default useRegister_c2s;
