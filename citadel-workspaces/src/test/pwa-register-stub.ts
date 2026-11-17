/**
 * Stand-in for `virtual:pwa-register/react`, which vite-plugin-pwa generates at
 * build time and therefore does not exist under vitest — the import fails to
 * resolve before any `vi.mock` can intervene, so an alias is the only way to let
 * PwaUpdatePrompt be tested at all.
 *
 * Intentionally inert. Tests mock this specifier with their own controllable
 * implementation; this exists so the module graph resolves, and so a test that
 * forgets to mock gets a component that does nothing rather than a crash.
 */
export interface RegisterSWOptions {
  onRegisteredSW?: (url: string, registration?: ServiceWorkerRegistration) => void;
  onRegisterError?: (error: unknown) => void;
}

export function useRegisterSW(_options?: RegisterSWOptions): { offlineReady: [boolean, (value: boolean) => void]; needRefresh: [boolean, (value: boolean) => void]; updateServiceWorker: (_reloadPage?: boolean) => Promise<void>; } {
  return {
    offlineReady: [false, (): void => {}] as [boolean, (value: boolean) => void],
    needRefresh: [false, (): void => {}] as [boolean, (value: boolean) => void],
    updateServiceWorker: async (_reloadPage?: boolean): Promise<void> => {},
  };
}

/**
 * Stand-in for the non-React `virtual:pwa-register`, used by main.tsx to
 * register the service worker outside the React tree.
 */
export function registerSW(_options?: {
  immediate?: boolean;
  onRegisteredSW?: (url: string, registration?: ServiceWorkerRegistration) => void;
  onRegisterError?: (error: unknown) => void;
}) {
  return async (_reloadPage?: boolean): Promise<void> => {};
}
