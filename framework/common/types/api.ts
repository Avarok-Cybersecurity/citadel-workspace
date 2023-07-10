import { ApiHooks } from './hooks';

export type ApiFetcherOptions = {
  variables?: Variables;
};

export type ApiFetcherResults<T> = {
  data: T;
};

export type Variables = { [key: string]: string | any | undefined };
export type ApiInvokeTypes = 'message' | 'anything';
export interface ApiConfig {
  invoke<T>(
    type: ApiInvokeTypes,
    options: ApiFetcherOptions
  ): Promise<ApiFetcherResults<T>>;
}

export type ApiInvoker<T = any> = (
  options: ApiFetcherOptions
) => Promise<ApiFetcherResults<T>>;

export interface ApiProviderContext {
  hooks: ApiHooks;
  invoke: ApiInvoker;
}
