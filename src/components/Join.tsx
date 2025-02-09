import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shield, HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceConfig } from "@/types/workspace";

interface JoinProps {
  onNext: () => void;
  onBack: () => void;
}

export const Join = ({ onNext, onBack }: JoinProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [formData, setFormData] = useState({
    fullName: "",
    username: "",
    password: "",
    confirmPassword: "",
  });

  // Get connection and security settings from React Query cache
  const { data: serverData } = useQuery({
    queryKey: ['serverConnectForm'],
    queryFn: () => ({ serverAddress: '', password: '' }),
  });

  const { data: securitySettings } = useQuery({
    queryKey: ['securitySettings'],
    queryFn: () => ({
      securityLevel: 'standard',
      securityMode: 'enhanced',
      encryptionAlgorithm: 'aes',
      kemAlgorithm: 'kyber',
      signingAlgorithm: 'falcon',
      headerObfuscatorMode: 'off',
      psk: '',
    }),
  });

  console.log('Retrieved server data:', serverData);
  console.log('Retrieved security settings:', securitySettings);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.fullName || !formData.username || !formData.password || !formData.confirmPassword) {
      toast({
        title: "Missing Fields",
        description: "Please fill out all fields to continue",
        variant: "destructive",
      });
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      toast({
        title: "Password Mismatch",
        description: "The passwords you entered do not match",
        variant: "destructive",
      });
      return;
    }

    // Create workspace configuration
    const workspaceConfig: WorkspaceConfig = {
      // Connection details
      serverAddress: serverData?.serverAddress || '',
      password: serverData?.password,
      
      // Security settings
      securityLevel: securitySettings?.securityLevel || 'standard',
      securityMode: securitySettings?.securityMode || 'enhanced',
      
      // Advanced settings
      encryptionAlgorithm: securitySettings?.encryptionAlgorithm || 'aes',
      kemAlgorithm: securitySettings?.kemAlgorithm || 'kyber',
      signingAlgorithm: securitySettings?.signingAlgorithm || 'falcon',
      headerObfuscatorMode: securitySettings?.headerObfuscatorMode || 'off',
      psk: securitySettings?.psk,
      
      // Profile details
      fullName: formData.fullName,
      username: formData.username,
      profilePassword: formData.password,
    };

    console.log('Final workspace configuration:', workspaceConfig);
    
    onNext();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="w-full max-w-xl p-8 space-y-6 bg-[#4F5889]/95 backdrop-blur-sm border border-purple-500/20 shadow-lg rounded-lg">
        <div className="flex items-center gap-3 mb-8">
          <Shield className="w-8 h-8 text-white" />
          <h1 className="text-2xl font-bold text-white">ADD A NEW WORKSPACE</h1>
        </div>

        <div className="space-y-8">
          <h2 className="text-xl font-semibold text-white">SERVER PROFILE</h2>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Full Name Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-200 uppercase">
                Full Name
              </label>
              <div className="relative">
                <Input
                  name="fullName"
                  value={formData.fullName}
                  onChange={handleInputChange}
                  className="bg-[#221F26]/70 border-purple-400/20 text-white pr-12"
                  placeholder="John Doe"
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="bg-[#2A2438] border border-purple-400/30 text-white">
                      <p>Enter your full name as it will appear in the workspace</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            {/* Username Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-200 uppercase">
                Username
              </label>
              <div className="relative">
                <Input
                  name="username"
                  value={formData.username}
                  onChange={handleInputChange}
                  className="bg-[#221F26]/70 border-purple-400/20 text-white pr-12"
                  placeholder="john.doe.33"
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="bg-[#2A2438] border border-purple-400/30 text-white">
                      <p>Choose a unique username for your workspace profile</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-200 uppercase">
                Profile Password
              </label>
              <div className="relative">
                <Input
                  type="password"
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  className="bg-[#221F26]/70 border-purple-400/20 text-white pr-12"
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="bg-[#2A2438] border border-purple-400/30 text-white">
                      <p>Create a strong password for your profile</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            {/* Confirm Password Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-200 uppercase">
                Confirm Profile Password
              </label>
              <div className="relative">
                <Input
                  type="password"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  className="bg-[#221F26]/70 border-purple-400/20 text-white pr-12"
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="bg-[#2A2438] border border-purple-400/30 text-white">
                      <p>Re-enter your password to confirm</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
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
                type="submit"
                className="bg-purple-600 hover:bg-purple-700 text-white transition-colors"
              >
                JOIN
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
