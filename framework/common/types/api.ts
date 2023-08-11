import { ApiHooks } from '@framework/types/hooks';

export interface ApiInvokerOptions {
  type: ApiInvokeTypes;
}

export type Variables = { [key: string]: string };
export type ApiInvokeTypes =
  | 'message'
  | 'register'
  | 'connect'
  | 'disconnect'
  | 'getSession';
export interface ApiConfig {
  invoker: ApiInvoker;
}

export type ApiInvoker<I = any, O = any> = (
  type: ApiInvokeTypes,
  variables: I
) => Promise<ApiInvokerResults<O>>;

export interface ApiProviderContext {
  hooks: ApiHooks;
  invoker: ApiInvoker;
}
export type ApiInvokerResults<T> = {
  data: T;
};
