import { Button } from "@/components/ui/button";
import { MessageSquare, Search, Settings, Share2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { officeRooms } from "../layout/sidebar/RoomsSection";

interface OfficeLayoutProps {
  title: string;
  isEditing: boolean;
  onEditToggle: () => void;
  onSave?: () => void;
  children: React.ReactNode;
}

const officeNames = {
  company: "Company",
  marketing: "PR/Marketing",
  hr: "Human Resources"
};

export const OfficeLayout = ({ 
  title, 
  isEditing, 
  onEditToggle, 
  onSave, 
  children 
}: OfficeLayoutProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const currentSection = new URLSearchParams(location.search).get("section") || "company";
  const currentRoom = new URLSearchParams(location.search).get("room");
  const officeName = officeNames[currentSection as keyof typeof officeNames];
  
  const rooms = officeRooms[currentSection as keyof typeof officeRooms] || [];
  const currentRoomData = rooms.find(room => room.id === currentRoom);
  const roomName = currentRoomData ? ` → ${currentRoomData.name}` : "";

  const handleOfficeClick = () => {
    const params = new URLSearchParams(location.search);
    params.delete("room");
    navigate(`/office?${params.toString()}`);
  };

  return (
    <div className="h-[calc(100vh-3.5rem)] overflow-hidden bg-[#444A6C]">
      <div className="h-full flex flex-col">
        <div className="flex justify-between items-center px-4 py-2 border-b border-gray-800 bg-[#343A5C]">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-semibold text-white hidden md:block">
              <button 
                onClick={handleOfficeClick}
                className="hover:text-[#E5DEFF] transition-colors"
              >
                {officeName}
              </button>
              <span className="text-[#E5DEFF]">{roomName}</span>
            </h1>
          </div>
          <div className="flex items-center space-x-2">
            <Button 
              variant="ghost" 
              size="icon"
              className="text-white hover:bg-[#E5DEFF] hover:text-[#343A5C]"
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon"
              className="text-white hover:bg-[#E5DEFF] hover:text-[#343A5C]"
            >
              <Search className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon"
              className="text-white hover:bg-[#E5DEFF] hover:text-[#343A5C]"
            >
              <Share2 className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon"
              className="text-white hover:bg-[#E5DEFF] hover:text-[#343A5C]"
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary"
              className="bg-[#E5DEFF] text-[#343A5C] hover:bg-[#F1F0FB] hover:text-[#262C4A]"
              onClick={onEditToggle}
            >
              {isEditing ? "Cancel" : "Edit"}
            </Button>
            {isEditing && (
              <Button 
                onClick={onSave}
                className="bg-[#E5DEFF] text-[#343A5C] hover:bg-[#F1F0FB] hover:text-[#262C4A]"
              >
                Save Changes
              </Button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
};
