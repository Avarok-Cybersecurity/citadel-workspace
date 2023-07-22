import { ApiHooks } from '@framework/types/hooks';

export interface ApiInvokerOptions {
  type: ApiInvokeTypes;
  variables?: Variables;
}

export type Variables = { [key: string]: string };
export type ApiInvokeTypes = 'message' | 'register' | 'connect';
export interface ApiConfig {
  invoker<T>(options: ApiInvokerOptions): void;
}

export type ApiInvoker<T = any> = (
  type: ApiInvokeTypes,
  options: ApiInvokerOptions
) => Promise<ApiInvokerResults<T>> | void;

export interface ApiProviderContext {
  hooks: ApiHooks;
  invoker: ApiInvoker;
}
export type ApiInvokerResults<T> = {
  data: T;
};
