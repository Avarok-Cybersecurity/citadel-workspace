import { Building2, Home } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { useSidebar } from "@/components/ui/sidebar";

export const officeRooms = {
  company: [
    { id: "main", name: "Main Office", icon: Home },
    { id: "meeting-a", name: "Meeting Room A", icon: Building2 },
    { id: "meeting-b", name: "Meeting Room B", icon: Building2 },
  ],
  marketing: [
    { id: "creative", name: "Creative Studio", icon: Home },
    { id: "conference", name: "Conference Room", icon: Building2 },
    { id: "media", name: "Media Room", icon: Building2 },
  ],
  hr: [
    { id: "training", name: "Training Room", icon: Home },
    { id: "interview-a", name: "Interview Room A", icon: Building2 },
    { id: "interview-b", name: "Interview Room B", icon: Building2 },
  ],
};

export const RoomsSection = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { setOpenMobile } = useSidebar();
  const params = new URLSearchParams(location.search);
  const currentSection = params.get("section") || "company";
  const currentRoom = params.get("room");

  const handleRoomClick = (roomId: string) => {
    const params = new URLSearchParams(location.search);
    params.set("room", roomId);
    if (!params.has("section")) {
      params.set("section", "company");
    }
    navigate(`/office?${params.toString()}`);
    setOpenMobile(false);
  };

  const rooms = officeRooms[currentSection as keyof typeof officeRooms] || [];

  return (
    <SidebarGroup className="flex-shrink-0 min-h-[4rem] mb-4">
      <SidebarGroupLabel className="text-[#9b87f5] font-semibold">ROOMS</SidebarGroupLabel>
      <SidebarGroupContent>
        <ScrollArea className="max-h-[30vh]">
          <SidebarMenu>
            <div className="animate-fade-in">
              {rooms.map((room) => (
                <SidebarMenuItem key={room.id}>
                  <SidebarMenuButton 
                    className={`text-white hover:bg-[#E5DEFF] hover:text-[#343A5C] transition-colors
                      ${currentRoom === room.id ? 'bg-[#E5DEFF] text-[#343A5C] border border-[#9b87f5]' : ''}`}
                    onClick={() => handleRoomClick(room.id)}
                    data-active={currentRoom === room.id}
                  >
                    <room.icon className="h-4 w-4" />
                    <span>{room.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </div>
          </SidebarMenu>
        </ScrollArea>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};