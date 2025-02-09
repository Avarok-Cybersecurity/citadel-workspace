import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Shield, HelpCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useState } from 'react';

interface ServerConnectProps {
  onNext: () => void;
}

export const ServerConnect = ({ onNext }: ServerConnectProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: formData } = useQuery({
    queryKey: ['serverConnectForm'],
    queryFn: () => ({ serverAddress: '', password: '' }),
    initialData: { serverAddress: '', password: '' }
  });

  const [serverAddress, setServerAddress] = useState(formData.serverAddress);
  const [password, setPassword] = useState(formData.password);

  const { mutate: updateFormCache } = useMutation({
    mutationFn: (newData: { serverAddress: string; password: string }) => {
      console.log('Updating form cache:', newData);
      return Promise.resolve(newData);
    },
    onSuccess: (newData) => {
      queryClient.setQueryData(['serverConnectForm'], newData);
    },
  });

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverAddress) {
      toast({
        title: "Server address required",
        description: "Please enter a server address to connect",
        variant: "destructive",
      });
      return;
    }
    
    updateFormCache({ serverAddress, password });
    onNext();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="w-full max-w-xl p-8 space-y-6 bg-[#4F5889]/95 backdrop-blur-sm border border-purple-500/20 shadow-lg rounded-lg">
        <div className="flex items-center gap-3 mb-8">
          <Shield className="w-8 h-8 text-white" />
          <h1 className="text-2xl font-bold text-white">ADD A NEW WORKSPACE</h1>
        </div>

        <form onSubmit={handleConnect} className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-200 uppercase">
            Workspace Location
          </label>
          <div className="relative">
            <Input
              value={serverAddress}
              onChange={(e) => setServerAddress(e.target.value)}
              className="bg-[#221F26]/70 border-purple-400/20 text-white pr-12"
              placeholder="workspace-name.avarok.net"
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="bg-[#2A2438] border border-purple-400/30 text-white">
                  <p>Enter your workspace server address</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-200 uppercase">
            Workspace Password (Optional)
          </label>
          <div className="relative">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-[#221F26]/70 border-purple-400/20 text-white pr-12"
              placeholder="Enter workspace password"
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="bg-[#2A2438] border border-purple-400/30 text-white">
                  <p>Optional: Enter the workspace password if required</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        <div className="flex justify-end gap-4 mt-8">
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate("/")}
            className="text-white hover:bg-purple-500/20"
          >
            CANCEL
          </Button>
          <Button
            type="submit"
            className="bg-purple-600 hover:bg-purple-700 text-white transition-colors"
          >
            NEXT
          </Button>
        </div>
        </form>
      </div>
    </div>
  );
};
