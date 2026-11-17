import { useDialogOverlay } from '@/hooks/use-dialog-overlay';
import { DEFAULT_SECURITY_SETTINGS } from './security-settings-defaults';
import { Button } from "@/components/ui/button";
import { ChevronDown, ArrowRight } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { SecurityLevelSelect } from "./security/SecurityLevelSelect";
import { SecurityModeSelect } from "./security/SecurityModeSelect";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { AdvancedSettings } from "./security/AdvancedSettings";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { RegistrationStepIndicator } from "./RegistrationStepIndicator";
import {
  SecurityLevel,
  SecrecyMode,
  EncryptionAlgorithm,
  KemAlgorithm,
  SigAlgorithm
} from "@/types";
import { debugLog, debugEnabled } from '@/lib/debug-config';

export interface SecuritySettingsValues {
  securityLevel: SecurityLevel;
  secrecyMode: SecrecyMode;
  encryptionAlgorithm: EncryptionAlgorithm;
  kemAlgorithm: KemAlgorithm;
  sigAlgorithm: SigAlgorithm;
  headerObfuscatorSettings: Record<string, string>;
  /** Login only: offer passkey enrolment after sign-in. */
  enrolPasskey?: boolean;
}

interface SecuritySettingsProps {
  onNext: () => void;
  onBack: () => void;
  onComplete?: (settings: SecuritySettingsValues) => void;
  initialValues?: SecuritySettingsValues;
  isFromLogin?: boolean; // Flag to indicate if this is accessed from login flow
  /** The highest level the signing-in account can use (account-levels.ts). */
  maxSecurityLevel?: number;
}

export const SecuritySettings = ({
  onNext,
  onBack,
  onComplete,
  initialValues,
  isFromLogin = false,
  maxSecurityLevel,
}: SecuritySettingsProps): JSX.Element => {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [settings, setSettings] = useState<SecuritySettingsValues>(DEFAULT_SECURITY_SETTINGS);

  // Initialize settings with provided initialValues if available
  useEffect(() => {
    if (initialValues) {
      setSettings(prev => ({
        ...prev,
        ...initialValues
      }));
    }
  }, [initialValues]);

  const { mutate: updateSecuritySettings } = useMutation({
    mutationFn: (newSettings: SecuritySettingsValues) => {
      if (debugEnabled) {
        debugLog('SecuritySettings', 'Updating security settings:', JSON.stringify(newSettings));
      }
      return Promise.resolve(newSettings);
    },
    onSuccess: (updatedSettings) => {
      // NOT written to the query cache.
      //
      // Nothing observed the ['securitySettings'] key, so React Query dropped
      // the entry after its default five-minute gcTime and the registration
      // hook's `|| defaults` fallback quietly took over: a user who raised
      // their security level and then spent five minutes on the profile step
      // registered with the defaults, permanently, with nothing said. The
      // chosen values now travel by prop, like the server address does.

      // If onComplete is provided, call it with the current settings
      if (onComplete) {
        onComplete(updatedSettings);
      } else {
        onNext();
      }
    },
  });

  const handleNext = (): void => {
    // Update the security settings and let the onSuccess handler navigate
    updateSecuritySettings(settings);
  };

  const handleSettingChange = <K extends keyof SecuritySettingsValues>(key: K, value: SecuritySettingsValues[K]): void => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const { ref: dialogRef, dialogProps } = useDialogOverlay({ label: 'Security settings', onDismiss: onBack });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" ref={dialogRef} {...dialogProps}>
      <div className="w-full max-w-xl">
        <Card className="bg-background border-border shadow-2xl shadow-black/40">
          <CardHeader className="pb-4">
            {!isFromLogin && (
              <RegistrationStepIndicator currentStep={2} />
            )}
            <h2 className="text-xl font-bold text-foreground mt-5">Security Settings</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Configure security settings for your workspace connection
            </p>
          </CardHeader>

          <CardContent className="space-y-5 max-h-[calc(100dvh-16rem)] overflow-y-auto scrollbar-visible">
            <SecurityLevelSelect
              value={settings.securityLevel}
              onChange={(value) => handleSettingChange('securityLevel', value as SecurityLevel)}
              maxLevel={maxSecurityLevel}
            />

            <SecurityModeSelect
              value={settings.secrecyMode}
              onChange={(value) => handleSettingChange('secrecyMode', value)}
            />

            <div className="space-y-2">
              <button
                onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                className="flex items-center gap-2 text-muted-foreground w-full transition-colors duration-200 hover:text-primary-accent py-2"
              >
                <span className="text-xs font-semibold tracking-wider uppercase">Advanced Settings</span>
                <ChevronDown
                  className={cn(
                    "w-4 h-4 transition-transform duration-300",
                    isAdvancedOpen && "rotate-180"
                  )}
                />
              </button>

              {isAdvancedOpen && (
                <div className="pt-2 space-y-4 pl-1">
                  <AdvancedSettings
                    values={settings}
                    onChange={handleSettingChange}
                  />
                </div>
              )}
            </div>
          </CardContent>

          <CardFooter className="flex justify-between pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onBack}
              className="text-muted-foreground hover:text-foreground hover:bg-transparent"
            >
              Back
            </Button>
            <Button
              type="button"
              onClick={handleNext}
              data-testid="wizard-next"
              className="bg-primary hover:bg-primary/90 text-primary-foreground transition-all gap-2 px-5 rounded-lg shadow-lg shadow-primary-accent/20"
            >
              {isFromLogin ? "Save" : "Next"}
              {!isFromLogin && <ArrowRight className="w-4 h-4" />}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
};
