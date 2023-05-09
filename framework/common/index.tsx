import { createContext, ReactNode, useContext, useMemo } from 'react';
import { ApiConfig, ApiProviderContext } from './types/api';
import { ApiHooks } from './types/hooks';

interface ApiProviderProps {
  children: ReactNode | ReactNode[];

  hooks: ApiHooks;
}

export const ApiContext = createContext<Partial<ApiProviderContext>>({});

export const ApiProvider = ({ children, hooks }: ApiProviderProps) => {
  const coreConfig = useMemo(() => {
    return {
      hooks,
    };
  }, [hooks]);

  return (
    <ApiContext.Provider value={coreConfig}>{children}</ApiContext.Provider>
  );
};

export const useApiProvider = () => {
  return useContext(ApiContext) as ApiProviderContext;
};
