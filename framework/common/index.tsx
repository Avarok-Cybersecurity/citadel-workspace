import { createContext, ReactNode, useContext, useMemo } from 'react';
import { ApiConfig, ApiInvoker, ApiProviderContext } from './types/api';
import { ApiHooks } from '@framework/types/hooks';

interface ApiProviderProps {
  children: ReactNode | ReactNode[];
  config: ApiConfig;
  hooks: ApiHooks;
}

export const ApiContext = createContext<Partial<ApiProviderContext>>({});

export const ApiProvider = ({ children, config, hooks }: ApiProviderProps) => {
  const coreConfig = useMemo(() => {
    return {
      invoker: config.invoker as unknown as ApiInvoker,
      hooks,
    };
  }, [config.invoker, hooks]);

  return (
    <ApiContext.Provider value={coreConfig}>{children}</ApiContext.Provider>
  );
};

export const useApiProvider = () => {
  return useContext(ApiContext) as ApiProviderContext;
};
