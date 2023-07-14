import { ApiHooks } from '@framework/types/hooks';

export type ApiInvokerOptions = {
  type: ApiInvokeTypes;
  variables?: Variables;
};

export type Variables = { [key: string]: string | any | undefined };
export type ApiInvokeTypes = 'message' | 'register_c2s' | 'connect_c2s';
export interface ApiConfig {
  serviceUrl: string;
  invoker<T>(options: ApiInvokerOptions): void;
}

export type ApiInvoker<T = any> = (
  options: ApiInvokerOptions
) => Promise<ApiInvokerResults<T>> | void;

export interface ApiProviderContext {
  hooks: ApiHooks;
  invoker: ApiInvoker;
}
export type ApiInvokerResults<T> = {
  data: T;
};
