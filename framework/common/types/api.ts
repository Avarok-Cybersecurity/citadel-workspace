import { ApiHooks } from './hooks';

export type ApiInvokerOptions = {
  type: ApiInvokeTypes;
  variables?: Variables;
};

export type Variables = { [key: string]: string | any | undefined };
export type ApiInvokeTypes = 'message' | 'register_c2s' | 'connect_c2s';
export interface ApiConfig {
  serviceUrl: string;
  invokeApi<T>(options: ApiInvokerOptions): void;
}

export type ApiInvoker<T = any> = (
  options: ApiInvokerOptions
) => Promise<ApiInvokerResults<T>>;

export interface ApiProviderContext {
  hooks: ApiHooks;
  invokeApi: ApiInvoker;
}
export type ApiInvokerResults<T> = {
  data: T;
};
