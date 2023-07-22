import { useApiProvider } from '@common';
import { MutationHook } from '@common/types/hooks';
import { ApiHooks } from '@framework/types/hooks';

export const useHook = (fn: (apiHooks: ApiHooks) => MutationHook) => {
  const { hooks } = useApiProvider();
  return fn(hooks);
};

export const useMutationHook = (hook: MutationHook) => {
  const { invoker } = useApiProvider();
  return hook.useHook({
    invoke: <T>(input: T) => {
      return hook.invoker({
        input,
        invoke: invoker,
        options: hook.invokerOptions,
      });
    },
  });
};
