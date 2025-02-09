import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export const AdvancedSettings = () => {
  const [showPSKDialog, setShowPSKDialog] = useState(false);
  const [psk, setPsk] = useState("");

  const handleHeaderObfuscatorChange = (value: string) => {
    if (value === "psk") {
      setShowPSKDialog(true);
    }
  };

  return (
    <div className="space-y-6 mt-6 animate-fade-in">
      {/* Encryption Algorithm */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-200 uppercase">
          Encryption Algorithm
        </label>
        <div className="relative">
          <Select defaultValue="aes">
            <SelectTrigger className="w-full bg-[#221F26]/70 border-purple-400/20 text-white">
              <SelectValue placeholder="Select encryption algorithm" />
            </SelectTrigger>
            <SelectContent className="bg-[#2A2438] border border-purple-400/30 text-white shadow-xl p-2">
              <SelectItem value="aes" className="hover:bg-purple-500/20 focus:bg-purple-500/20 rounded-sm p-2">AES 256 GCM</SelectItem>
              <SelectItem value="chacha" className="hover:bg-purple-500/20 focus:bg-purple-500/20 rounded-sm p-2">ChaCha20Poly1305</SelectItem>
              <SelectItem value="hybrid" className="hover:bg-purple-500/20 focus:bg-purple-500/20 rounded-sm p-2">Hybrid Kyber/AES 256 GCM</SelectItem>
            </SelectContent>
          </Select>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="absolute right-12 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="bg-[#2A2438] border border-purple-400/30 text-white">
                <p>Choose the encryption algorithm for your workspace</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* KEM Algorithm */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-200 uppercase">
          KEM Algorithm
        </label>
        <div className="relative">
          <Select defaultValue="kyber">
            <SelectTrigger className="w-full bg-[#221F26]/70 border-purple-400/20 text-white">
              <SelectValue placeholder="Select KEM algorithm" />
            </SelectTrigger>
            <SelectContent className="bg-[#2A2438] border border-purple-400/30 text-white shadow-xl p-2">
              <SelectItem value="kyber" className="hover:bg-purple-500/20 focus:bg-purple-500/20 rounded-sm p-2">Kyber</SelectItem>
            </SelectContent>
          </Select>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="absolute right-12 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="bg-[#2A2438] border border-purple-400/30 text-white">
                <p>Select the Key Encapsulation Mechanism algorithm</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Signing Algorithm */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-200 uppercase">
          Signing Algorithm
        </label>
        <div className="relative">
          <Select defaultValue="falcon">
            <SelectTrigger className="w-full bg-[#221F26]/70 border-purple-400/20 text-white">
              <SelectValue placeholder="Select signing algorithm" />
            </SelectTrigger>
            <SelectContent className="bg-[#2A2438] border border-purple-400/30 text-white shadow-xl p-2">
              <SelectItem value="falcon" className="hover:bg-purple-500/20 focus:bg-purple-500/20 rounded-sm p-2">Falcon1024</SelectItem>
            </SelectContent>
          </Select>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="absolute right-12 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="bg-[#2A2438] border border-purple-400/30 text-white">
                <p>Choose the digital signature algorithm</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Header Obfuscator Mode */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-200 uppercase">
          Header Obfuscator Mode
        </label>
        <div className="relative">
          <Select defaultValue="off" onValueChange={handleHeaderObfuscatorChange}>
            <SelectTrigger className="w-full bg-[#221F26]/70 border-purple-400/20 text-white">
              <SelectValue placeholder="Select header obfuscator mode" />
            </SelectTrigger>
            <SelectContent className="bg-[#2A2438] border border-purple-400/30 text-white shadow-xl p-2">
              <SelectItem value="off" className="hover:bg-purple-500/20 focus:bg-purple-500/20 rounded-sm p-2">Off</SelectItem>
              <SelectItem value="on" className="hover:bg-purple-500/20 focus:bg-purple-500/20 rounded-sm p-2">On</SelectItem>
              <SelectItem value="psk" className="hover:bg-purple-500/20 focus:bg-purple-500/20 rounded-sm p-2">PSK</SelectItem>
            </SelectContent>
          </Select>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="absolute right-12 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="bg-[#2A2438] border border-purple-400/30 text-white">
                <p>Configure header obfuscation settings</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* PSK Dialog */}
      <Dialog open={showPSKDialog} onOpenChange={setShowPSKDialog}>
        <DialogContent className="bg-[#2A2438] text-white border border-purple-400/30">
          <DialogHeader>
            <DialogTitle>Enter Pre-Shared Key (PSK)</DialogTitle>
            <DialogDescription className="text-gray-300">
              Please enter your PSK for header obfuscation.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            placeholder="Enter your PSK"
            value={psk}
            onChange={(e) => setPsk(e.target.value)}
            className="bg-[#221F26]/70 border-purple-400/20 text-white"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowPSKDialog(false)}
              className="text-white hover:bg-purple-500/20"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              onClick={() => {
                console.log('PSK stored:', psk);
                setShowPSKDialog(false);
              }}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};