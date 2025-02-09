import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export const SecurityModeSelect = () => {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-gray-200 uppercase">
        Security Mode
      </label>
      <div className="relative">
        <Select defaultValue="enhanced">
          <SelectTrigger className="w-full bg-[#221F26]/70 border-purple-400/20 text-white pr-12">
            <SelectValue placeholder="Select security mode" />
          </SelectTrigger>
          <SelectContent className="bg-[#2A2438] border border-purple-400/30 text-white shadow-xl p-1">
            <SelectItem value="enhanced" className="hover:bg-purple-500/20 focus:bg-purple-500/20 rounded-sm">Enhanced Forward Secrecy</SelectItem>
            <SelectItem value="true" className="hover:bg-purple-500/20 focus:bg-purple-500/20 rounded-sm">True Perfect Forward Secrecy</SelectItem>
          </SelectContent>
        </Select>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="bg-[#2A2438] border border-purple-400/30 text-white">
              <p>Choose your preferred security mode for encrypted communications</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
};