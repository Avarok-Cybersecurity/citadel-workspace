import { ApiInvoker, ApiInvokerOptions } from './api';

export type MutationHookContext = {
  invoke: (input: any) => any;
};

export type InvokerHookContext = {
  input?: any;
  invoke: ApiInvoker;
  options: ApiInvokerOptions
};
export type MutationHook = {
  invokerOptions: ApiInvokerOptions,
  invoker: (context: InvokerHookContext) => any;
  useHook(context: MutationHookContext): (input: any) => any;
};
