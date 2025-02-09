
import { useState, useEffect } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocation, useNavigate } from "react-router-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ServerConnect } from "@/components/ServerConnect";
import { SecuritySettings } from "@/components/SecuritySettings";
import { Join } from "@/components/Join";

interface Workspace {
  id: string;
  name: string;
  logoUrl: string;
}

const workspaces: Workspace[] = [
  {
    id: "1",
    name: "AVAROK CYBERSECURITY",
    logoUrl: "/lovable-uploads/cc2f58c1-680a-4b27-bbfe-f2ebe9c70797.png"
  },
  {
    id: "2",
    name: "ACME CORP",
    logoUrl: "/placeholder.svg"
  },
  {
    id: "3",
    name: "STARK INDUSTRIES",
    logoUrl: "/placeholder.svg"
  }
];

type WorkflowStep = "connect" | "security" | "join";

export const WorkspaceSwitcher = () => {
  const [currentWorkspace, setCurrentWorkspace] = useState(workspaces[0]);
  const [isOpen, setIsOpen] = useState(false);
  const [workspaceRoutes, setWorkspaceRoutes] = useState<Record<string, string>>({});
  const [isAddingWorkspace, setIsAddingWorkspace] = useState(false);
  const [currentStep, setCurrentStep] = useState<WorkflowStep>("connect");
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setWorkspaceRoutes(prev => ({
      ...prev,
      [currentWorkspace.id]: location.pathname + location.search
    }));
  }, [location.pathname, location.search, currentWorkspace.id]);

  const handleWorkspaceChange = (workspace: Workspace) => {
    console.log('Switching to workspace:', workspace.name);
    const savedRoute = workspaceRoutes[workspace.id];
    console.log('Saved route for workspace:', savedRoute);
    
    document.querySelector('.office-content')?.classList.add('animate-fade-out');

    setTimeout(() => {
      setCurrentWorkspace(workspace);
      setIsOpen(false);
      
      if (savedRoute) {
        navigate(savedRoute);
      } else {
        navigate('/office');
      }
      
      document.querySelector('.office-content')?.classList.remove('animate-fade-out');
      document.querySelector('.office-content')?.classList.add('animate-fade-in');
    }, 300);
  };

  const handleAddWorkspace = () => {
    setIsAddingWorkspace(true);
    setCurrentStep("connect");
  };

  const handleNext = () => {
    switch (currentStep) {
      case "connect":
        setCurrentStep("security");
        break;
      case "security":
        setCurrentStep("join");
        break;
      case "join":
        setIsAddingWorkspace(false);
        setCurrentStep("connect");
        break;
    }
  };

  const handleBack = () => {
    switch (currentStep) {
      case "security":
        setCurrentStep("connect");
        break;
      case "join":
        setCurrentStep("security");
        break;
    }
  };

  return (
    <>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild className="-ml-2">
          <button 
            className="flex items-center gap-3 py-2 hover:bg-[#E5DEFE] transition-colors rounded-r-md w-[calc(100%+0.5rem)] group bg-transparent"
          >
            <img
              src={currentWorkspace.logoUrl}
              alt={currentWorkspace.name}
              className="w-8 h-8 rounded ml-2"
            />
            <span className="font-semibold text-white flex-1 text-left group-hover:text-[#1C1D28]">{currentWorkspace.name}</span>
            <ChevronRight 
              className={cn(
                "w-5 h-5 text-white group-hover:text-[#1C1D28] transition-transform duration-300 mr-2",
                isOpen && "rotate-90"
              )} 
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent 
          align="start"
          sideOffset={0}
          className="w-[calc(var(--radix-dropdown-menu-trigger-width)+0.5rem)] -ml-2 bg-[#252424] border border-gray-800"
          style={{ "--trigger-width": "var(--radix-dropdown-menu-trigger-width)" } as React.CSSProperties}
        >
          {workspaces
            .filter(workspace => workspace.id !== currentWorkspace.id)
            .map((workspace) => (
              <DropdownMenuItem
                key={workspace.id}
                onClick={() => handleWorkspaceChange(workspace)}
                className="flex items-center gap-3 py-3 hover:bg-[#E5DEFE] transition-colors cursor-pointer text-white w-full pl-2 group bg-transparent"
              >
                <img
                  src={workspace.logoUrl}
                  alt={workspace.name}
                  className="w-8 h-8 rounded"
                />
                <span className="font-semibold flex-1 group-hover:text-[#1C1D28]">{workspace.name}</span>
              </DropdownMenuItem>
            ))}
          <DropdownMenuItem
            onClick={handleAddWorkspace}
            className="flex items-center gap-3 py-3 hover:bg-[#E5DEFE] transition-colors cursor-pointer text-white w-full border-t border-gray-700 pl-2 group bg-transparent"
          >
            <div className="w-8 h-8 rounded bg-[#6E59A5] flex items-center justify-center">
              <Plus className="w-5 h-5" />
            </div>
            <span className="font-semibold group-hover:text-[#1C1D28]">JOIN NEW WORKSPACE</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isAddingWorkspace} onOpenChange={setIsAddingWorkspace}>
        <DialogContent className="p-0 bg-transparent border-none max-w-xl">
          {currentStep === "connect" && (
            <ServerConnect onNext={handleNext} />
          )}
          {currentStep === "security" && (
            <SecuritySettings onNext={handleNext} onBack={handleBack} />
          )}
          {currentStep === "join" && (
            <Join onNext={handleNext} onBack={handleBack} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default WorkspaceSwitcher;
