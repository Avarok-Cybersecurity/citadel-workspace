import { Button } from "@/components/ui/button";
import { Shield, ChevronDown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SecurityLevelSelect } from "./security/SecurityLevelSelect";
import { SecurityModeSelect } from "./security/SecurityModeSelect";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { AdvancedSettings } from "./security/AdvancedSettings";

interface SecuritySettingsProps {
  onNext: () => void;
  onBack: () => void;
}

export const SecuritySettings = ({ onNext, onBack }: SecuritySettingsProps) => {
  const navigate = useNavigate();
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const queryClient = useQueryClient();

  const { mutate: updateSecuritySettings } = useMutation({
    mutationFn: (settings: any) => {
      console.log('Updating security settings:', settings);
      return Promise.resolve(settings);
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(['securitySettings'], settings);
    },
  });

  const handleNext = () => {
    updateSecuritySettings({
      securityLevel: 'standard',
      securityMode: 'enhanced',
      encryptionAlgorithm: 'aes',
      kemAlgorithm: 'kyber',
      signingAlgorithm: 'falcon',
      headerObfuscatorMode: 'off',
      psk: '',
    });
    
    onNext();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="w-full max-w-xl p-8 space-y-8 bg-[#4F5889]/95 backdrop-blur-sm border border-purple-500/20 shadow-lg rounded-lg">
        <div className="flex items-center gap-3 mb-8">
          <Shield className="w-8 h-8 text-white" />
          <h1 className="text-2xl font-bold text-white">ADD A NEW WORKSPACE</h1>
        </div>

        <div className="space-y-8">
          <h2 className="text-xl font-semibold text-white">SESSION SECURITY SETTINGS</h2>

          <div className="space-y-6">
            <SecurityLevelSelect />
            <SecurityModeSelect />

            <div className="space-y-2">
              <button 
                onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                className="flex items-center text-white space-x-2 w-full transition-colors duration-200 hover:text-purple-300"
              >
                <span className="text-lg font-semibold">ADVANCED SETTINGS</span>
                <ChevronDown 
                  className={cn(
                    "w-5 h-5 transition-transform duration-300",
                    isAdvancedOpen && "rotate-180"
                  )} 
                />
              </button>
              
              <div className={cn(
                "transition-all duration-300 ease-out",
                isAdvancedOpen ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
              )}>
                <div className="pt-4">
                  <AdvancedSettings />
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-4 mt-8">
            <Button
              type="button"
              variant="ghost"
              onClick={onBack}
              className="text-white hover:bg-purple-500/20"
            >
              BACK
            </Button>
            <Button
              type="button"
              onClick={handleNext}
              className="bg-purple-600 hover:bg-purple-700 text-white transition-colors"
            >
              NEXT
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
