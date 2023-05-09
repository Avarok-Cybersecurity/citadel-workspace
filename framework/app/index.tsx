import { ReactNode } from 'react';
import {
  ApiProvider as CoreApiProvider,
  useApiProvider as useCoreApiProvider,
} from '../common';

import { appHooks } from './hooks';
// import { getConfig } from './api/config';
// const config = getConfig();
interface AppApiProviderProps {
  children: ReactNode | ReactNode[];
}

export const ApiProvider = ({ children }: AppApiProviderProps) => {
  return <CoreApiProvider hooks={appHooks}>{children}</CoreApiProvider>;
};

export const useApiProvider = () => useCoreApiProvider();
