import { ApiInvoker, ApiInvokerOptions } from './api';

export type MutationHookContext<I, O> = {
  invoke: (input: I) => Promise<O>;
};

export type HookInvokerContext<I, O> = {
  input: I;
  invoke: ApiInvoker<I, O>;
  options: ApiInvokerOptions;
};

export type HookInvokerFn<I, O> = (
  context: HookInvokerContext<I, O>
) => Promise<O>;

export type HookDescriptor = {
  invokerInput: any;
  dataReturn: any;
};

export type MutationHook<H extends HookDescriptor = any> = {
  invokerOptions: ApiInvokerOptions;
  invoker: HookInvokerFn<H['invokerInput'], H['dataReturn']>;
  useHook(
    context: MutationHookContext<H['invokerInput'], H['dataReturn']>
  ): () => (input: H['invokerInput']) => Promise<H['dataReturn']>;
};
