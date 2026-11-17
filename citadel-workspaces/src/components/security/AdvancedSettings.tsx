import { useState, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HelpHint } from "@/components/shared/HelpHint";
import { SecuritySettingsValues } from "../SecuritySettings";
import { Label } from "@/components/ui/label";
import {
  EncryptionAlgorithm,
  KemAlgorithm,
  SigAlgorithm
} from "@/types";
import { PskDialog } from "./PskDialog";

interface AdvancedSettingsProps {
  values: SecuritySettingsValues;
  onChange: <K extends keyof SecuritySettingsValues>(key: K, value: SecuritySettingsValues[K]) => void;
}

export const AdvancedSettings = ({ values, onChange }: AdvancedSettingsProps): JSX.Element => {
  const [showPSKDialog, setShowPSKDialog] = useState(false);
  const [psk, setPsk] = useState(values.headerObfuscatorSettings?.psk || "");

  const [obfuscatorUIMode, setObfuscatorUIMode] = useState<'off' | 'on' | 'psk'>(() => {
    if (!values.headerObfuscatorSettings || Object.keys(values.headerObfuscatorSettings).length === 0) {
      return 'off';
    }
    return values.headerObfuscatorSettings.psk ? 'psk' : 'on';
  });

  useEffect(() => {
    setPsk(values.headerObfuscatorSettings?.psk || "");
    setObfuscatorUIMode(() => {
      if (!values.headerObfuscatorSettings || Object.keys(values.headerObfuscatorSettings).length === 0) {
        return 'off';
      }
      return values.headerObfuscatorSettings.psk ? 'psk' : 'on';
    });
  }, [values.headerObfuscatorSettings]);

  const handleValueChange = <K extends keyof SecuritySettingsValues>(key: K, value: SecuritySettingsValues[K]): void => {
    if (onChange) {
      onChange(key, value);
    }
  };

  const handleHeaderObfuscatorChange = (uiMode: 'off' | 'on' | 'psk'): void => {
    setObfuscatorUIMode(uiMode);

    let newSettings: Record<string, string> = {};
    if (uiMode === 'on') {
      newSettings = { mode: 'enabled' };
      handleValueChange('headerObfuscatorSettings', newSettings);
    } else if (uiMode === 'psk') {
      newSettings = { mode: 'psk', psk: values.headerObfuscatorSettings?.psk || "" };
      handleValueChange('headerObfuscatorSettings', newSettings);
      if (!newSettings.psk) {
        setShowPSKDialog(true);
      }
    } else {
      handleValueChange('headerObfuscatorSettings', {});
    }
  };

  const handleSavePSK = (): void => {
    const newSettings: { mode: string; psk: string; } = { ...values.headerObfuscatorSettings, mode: 'psk', psk: psk };
    handleValueChange('headerObfuscatorSettings', newSettings);
    setShowPSKDialog(false);
  };

  return (
    <div className="space-y-5">
      {/* Encryption Algorithm */}
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <Label htmlFor="encryption-algorithm" className="text-foreground/80">
            Encryption Algorithm
          </Label>
          <HelpHint topic="Encryption Algorithm">Choose the encryption algorithm for your workspace</HelpHint>
        </div>
        <div className="relative">
          <Select
            value={values.encryptionAlgorithm || 'AES_GCM_256'}
            onValueChange={(value: EncryptionAlgorithm) => handleValueChange('encryptionAlgorithm', value)}
            defaultValue={'AES_GCM_256'}
          >
            <SelectTrigger id="encryption-algorithm" className="w-full bg-surface text-foreground">
              <SelectValue placeholder="Select encryption algorithm" />
            </SelectTrigger>
            <SelectContent className="bg-card border border-primary-accent/30 text-foreground shadow-xl p-2">
              <SelectItem value={'AES_GCM_256'} className="hover:bg-primary-accent/20 focus:bg-primary-accent/20 rounded-sm p-2">AES 256 GCM</SelectItem>
              <SelectItem value={'ChaCha20Poly_1305'} className="hover:bg-primary-accent/20 focus:bg-primary-accent/20 rounded-sm p-2">ChaCha20Poly1305</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KEM Algorithm */}
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <Label htmlFor="kem-algorithm" className="text-foreground/80">
            KEM Algorithm
          </Label>
          <HelpHint topic="KEM Algorithm">Choose the key encapsulation mechanism (KEM)</HelpHint>
        </div>
        <div className="relative">
          <Select
            value={values.kemAlgorithm || 'MlKem'}
            onValueChange={(value: KemAlgorithm) => handleValueChange('kemAlgorithm', value)}
            defaultValue={'MlKem'}
          >
            <SelectTrigger id="kem-algorithm" className="w-full bg-surface text-foreground">
              <SelectValue placeholder="Select KEM algorithm" />
            </SelectTrigger>
            <SelectContent className="bg-card border border-primary-accent/30 text-foreground shadow-xl p-2">
              <SelectItem value={'MlKem'} className="hover:bg-primary-accent/20 focus:bg-primary-accent/20 rounded-sm p-2">ML-KEM</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Signing Algorithm */}
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <Label htmlFor="signing-algorithm" className="text-foreground/80">
            Signing Algorithm
          </Label>
          <HelpHint topic="Signing Algorithm">Choose the digital signature algorithm</HelpHint>
        </div>
        <div className="relative">
          <Select
            value={values.sigAlgorithm || 'None'}
            onValueChange={(value: SigAlgorithm) => handleValueChange('sigAlgorithm', value)}
            defaultValue={'None'}
          >
            <SelectTrigger id="signing-algorithm" className="w-full bg-surface text-foreground">
              <SelectValue placeholder="Select signing algorithm" />
            </SelectTrigger>
            <SelectContent className="bg-card border border-primary-accent/30 text-foreground shadow-xl p-2">
              <SelectItem value={'None'} className="hover:bg-primary-accent/20 focus:bg-primary-accent/20 rounded-sm p-2">None</SelectItem>
              <SelectItem value={'MlDsa65'} className="hover:bg-primary-accent/20 focus:bg-primary-accent/20 rounded-sm p-2">ML-DSA-65</SelectItem>
              <SelectItem value={'FnDsa512'} className="hover:bg-primary-accent/20 focus:bg-primary-accent/20 rounded-sm p-2">FN-DSA-512</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Header Obfuscator Mode */}
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <Label htmlFor="header-obfuscator" className="text-foreground/80">
            Header Obfuscator Mode
          </Label>
          <HelpHint topic="Header Obfuscator Mode">Configure header obfuscation settings</HelpHint>
        </div>
        <div className="relative">
          <Select
            value={obfuscatorUIMode}
            onValueChange={handleHeaderObfuscatorChange}
            defaultValue={'off'}
          >
            <SelectTrigger id="header-obfuscator" className="w-full bg-surface text-foreground">
              <SelectValue placeholder="Select header obfuscator mode" />
            </SelectTrigger>
            <SelectContent className="bg-card border border-primary-accent/30 text-foreground shadow-xl p-2">
              <SelectItem value="off" className="hover:bg-primary-accent/20 focus:bg-primary-accent/20 rounded-sm p-2">Off</SelectItem>
              <SelectItem value="on" className="hover:bg-primary-accent/20 focus:bg-primary-accent/20 rounded-sm p-2">On</SelectItem>
              <SelectItem value="psk" className="hover:bg-primary-accent/20 focus:bg-primary-accent/20 rounded-sm p-2">PSK</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* PSK Dialog */}
      <PskDialog
        open={showPSKDialog}
        onOpenChange={setShowPSKDialog}
        psk={psk}
        onPskChange={setPsk}
        onSave={handleSavePSK}
      />
    </div>
  );
};
