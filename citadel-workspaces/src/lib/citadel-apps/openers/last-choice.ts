/**
 * The app a person last chose to open each extension in, on this device: a per-viewer convenience
 * (the resolver puts it first, openers.ts), never a source of truth. In `localStorage` under
 * `citadel:opens:<extension>`; every access is wrapped, since storage can be absent or throw (a
 * private window, blocked site data), and without it the first-party app comes first, as it would.
 */
const PREFIX: string = 'citadel:opens:';

export interface LastChoices {
  of(extension: string): string | null;
  choose(extension: string, appId: string): void;
}

export function lastChoicesIn(storage: () => Storage | null): LastChoices {
  return {
    of: (extension: string): string | null => {
      try {
        return extension === '' ? null : storage()?.getItem(PREFIX + extension) ?? null;
      } catch {
        return null;
      }
    },
    choose: (extension: string, appId: string): void => {
      try {
        if (extension !== '') storage()?.setItem(PREFIX + extension, appId);
      } catch {
        // Full or blocked: the next file opens in the first-party app instead. Nothing is lost.
      }
    },
  };
}

export const deviceLastChoices: LastChoices = lastChoicesIn((): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
});
