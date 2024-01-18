import { ApiHooks } from 'hooks/types/hooks';

export interface ApiInvokerOptions {
  type: ApiInvokeTypes;
}

export type Variables = { [key: string]: string };
export type ApiInvokeTypes =
  | 'message'
  | 'register'
  | 'connect'
  | 'disconnect'
  | 'getSession'
  | 'getAccInfo';

export interface ApiProviderContext {
  hooks: ApiHooks;
}
export type ApiInvokerResults<T> = {
  data: T;
};
