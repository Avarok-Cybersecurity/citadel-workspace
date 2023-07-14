export type MutationHookContext = {
  invoke: (input: any) => any;
};
export type MutationHook = {
  invoker: (input: any) => any;
  useHook(context: MutationHookContext): (input: any) => any;
};
