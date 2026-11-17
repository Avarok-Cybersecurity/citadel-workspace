import type React from "react";
import { ChevronDown, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { SecuritySettingsState } from "./useLoginHandler";
import type { PasskeyAccount } from "./passkey/usePasskeyAccount";
import { PASSKEY_COPY } from "@/lib/passkey/copy";

/**
 * The login form's Advanced Options section.
 *
 * Split out of `Login.tsx` when that file crossed the 250-line ceiling. An exact
 * piecewise move: the markup is unchanged, the two pieces of state it reads are
 * props, and the toggle is a callback. Nothing here decides anything.
 *
 * The switch that was "Remember Credentials" -- a plaintext password on the
 * agent -- now asks to enrol a passkey after sign-in instead. It is not shown
 * for an account that already has one here (Settings adds more), and where
 * WebAuthn cannot run the reason is said rather than a dead switch shown.
 */
export interface LoginAdvancedOptionsProps {
  isOpen: boolean;
  onToggle: () => void;
  onConfigureSecurity: () => void;
  securitySettings: SecuritySettingsState;
  setSecuritySettings: React.Dispatch<React.SetStateAction<SecuritySettingsState>>;
  passkey: PasskeyAccount;
}

export function LoginAdvancedOptions({
  isOpen: isAdvancedOpen,
  onToggle,
  onConfigureSecurity,
  securitySettings,
  setSecuritySettings,
  passkey,
}: LoginAdvancedOptionsProps): JSX.Element {
  return (
    <>
      {/* Advanced Options */}
      <button
        type="button"
        data-testid="login-advanced-options"
        className="tap-target flex items-center gap-2 text-muted-foreground w-full transition-colors duration-200 hover:text-primary-accent py-1"
        onClick={() => onToggle()}
      >
        <Settings className="h-3.5 w-3.5" />
        <span className="text-xs font-semibold tracking-wider uppercase">Advanced Options</span>
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200 ml-auto", isAdvancedOpen && "rotate-180")} />
      </button>

      {isAdvancedOpen && (
        <div className="space-y-3 p-3 bg-input rounded-lg border border-border">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
              Security Settings
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-primary-accent/50 text-primary-accent hover:bg-primary-accent/15 hover:text-foreground text-xs h-7 px-3 rounded-md"
              onClick={() => onConfigureSecurity()}
            >
              Configure
            </Button>
          </div>

          {!passkey.available ? (
            <p className="text-xs text-muted-foreground">{PASSKEY_COPY.unavailableHere}</p>
          ) : !passkey.hasKeys && (
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="enrol-passkey"
                className="text-xs font-semibold tracking-wider uppercase text-muted-foreground cursor-pointer"
              >
                {PASSKEY_COPY.enrolSwitch}
              </label>
              <Switch
                id="enrol-passkey"
                checked={securitySettings.enrolPasskey}
                onCheckedChange={(checked) => setSecuritySettings({
                  ...securitySettings,
                  enrolPasskey: checked
                })}
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}
