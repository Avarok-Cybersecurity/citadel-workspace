import { ApiHooks } from '@framework/types/hooks';

export interface ApiInvokerOptions {
  type: ApiInvokeTypes;
}

export type Variables = { [key: string]: string };
export type ApiInvokeTypes = 'message' | 'register' | 'connect';
export interface ApiConfig {
  invoker: ApiInvoker;
}

export type ApiInvoker<T = any> = (
  type: ApiInvokeTypes,
  variables: Variables
) => Promise<ApiInvokerResults<T>> | void;

export interface ApiProviderContext {
  hooks: ApiHooks;
  invoker: ApiInvoker;
}
export type ApiInvokerResults<T> = {
  data: T;
};
