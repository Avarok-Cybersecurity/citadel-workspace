/**
 * What the service should believe after trying to load its settings.
 *
 * Extracted rather than inlined in `init()` for the reason the siblings in this
 * directory were (`connection-success.ts`, `reconnect-logic.ts`): the service
 * class sits in an import cycle through `index.ts`, so a test that constructs it
 * cannot load it at all — and a decision that can only be reached by mocking
 * five collaborators is a decision nobody checks.
 *
 * The rule it encodes: a read that FAILED is not a preference.
 *
 * `init()` used to catch whatever the loaders threw, set `isEnabled = true` and
 * `isInitialized = true`, and return. Since `init()` returns early when
 * initialised, that latched the wrong answer for the whole session: one
 * timed-out request and a user who turned auto-connect off had it back on until
 * they reloaded the page. The loaders returned their defaults on failure too, so
 * this was the second of two layers swallowing the same distinction.
 *
 * Unknown resolves to OFF, not to the documented default of on. Not connecting
 * when the user wanted it is visible and recoverable; connecting when they asked
 * not to is neither. And `initialized: false` means the next call tries again
 * rather than trusting an answer nobody obtained.
 */

export interface AutoConnectSettings {
  enabled: boolean;
  userDisconnectedSessions: Set<string>;
  /** False when the settings could not be read, so `init()` should retry. */
  initialized: boolean;
}

export interface SettingsLoaders {
  loadEnabled: () => Promise<boolean>;
  loadUserDisconnected: () => Promise<Set<string>>;
}

export async function loadAutoConnectSettings(
  loaders: SettingsLoaders,
  onUnreadable: (error: unknown) => void,
): Promise<AutoConnectSettings> {
  try {
    const enabled: boolean = await loaders.loadEnabled();
    const userDisconnectedSessions: Set<string> = await loaders.loadUserDisconnected();
    return { enabled, userDisconnectedSessions, initialized: true };
  } catch (error) {
    onUnreadable(error);
    return { enabled: false, userDisconnectedSessions: new Set<string>(), initialized: false };
  }
}
