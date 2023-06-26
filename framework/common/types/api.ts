import { ApiHooks } from './hooks';

export type ApiFetcherOptions = {
  variables?: Variables;
};

export type ApiFetcherResults<T> = {
  data: T;
};

export type Variables = { [key: string]: string | any | undefined };

export interface ApiConfig {
  fetch<T>(options: ApiFetcherOptions): Promise<ApiFetcherResults<T>>;
}

export type ApiFetcher<T = any> = (
  options: ApiFetcherOptions
) => Promise<ApiFetcherResults<T>>;

export interface ApiProviderContext {
  hooks: ApiHooks;
  fetcher: ApiFetcher;
}
