/**
 * The workspace's "require a human check to sign in" setting, behind a port.
 *
 * It is `require_turnstile_sign_in` in the kernel's sign-in settings
 * (WorkspaceProtocol `GetSignInSettings` / `UpdateSignInSettings`, the update
 * admin-only), off unless an admin turns it on. The server keeps it where its
 * admission check reads it at every sign-in, so what `read` and `write` answer
 * is what that check enforces. This module is the one place the UI touches it.
 */
import type { SignInSettings } from 'citadel-workspace-client-ts';
import WorkspaceService from '@/lib/workspace-service';

export const REQUIRE_TURNSTILE_FIELD: 'require_turnstile_sign_in' = 'require_turnstile_sign_in';

/**
 * The kernel's answer when its host keeps no sign-in settings (a self-hosted
 * server: kernel/sign_in.rs `NOT_SUPPORTED`). An older kernel does not know the
 * request at all, and serde says so by name.
 */
export const NO_SUCH_SETTING: string = 'this workspace server has no sign-in settings';
const UNKNOWN_REQUEST: RegExp = /unknown variant `GetSignInSettings`/;

export interface AdmissionSettingPort {
  /** The stored value, or null when this workspace's server has no such setting. Rejects with any other failure. */
  read: () => Promise<boolean | null>;
  /** Resolves with what the server stored; rejects with the server's reason. */
  write: (required: boolean) => Promise<boolean>;
}

/** The two workspace requests the port is made of. */
export interface SignInSettingsRequests {
  getSignInSettings: () => Promise<SignInSettings>;
  updateSignInSettings: (settings: SignInSettings) => Promise<SignInSettings>;
}

const unsupported = (error: unknown): boolean =>
  error instanceof Error && (error.message === NO_SUCH_SETTING || UNKNOWN_REQUEST.test(error.message));

export function admissionSettingOver(requests: SignInSettingsRequests): AdmissionSettingPort {
  return {
    read: async (): Promise<boolean | null> => {
      try {
        return (await requests.getSignInSettings())[REQUIRE_TURNSTILE_FIELD];
      } catch (error: unknown) {
        if (unsupported(error)) return null;
        throw error;
      }
    },
    write: async (required: boolean): Promise<boolean> =>
      (await requests.updateSignInSettings({ [REQUIRE_TURNSTILE_FIELD]: required }))[REQUIRE_TURNSTILE_FIELD],
  };
}

/** The production port: the current session's workspace server. */
export const kernelAdmissionSetting: AdmissionSettingPort = admissionSettingOver({
  getSignInSettings: (): Promise<SignInSettings> => WorkspaceService.getSignInSettings(),
  updateSignInSettings: (settings: SignInSettings): Promise<SignInSettings> => WorkspaceService.updateSignInSettings(settings),
});
