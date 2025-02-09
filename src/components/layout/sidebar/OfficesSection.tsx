import { useLocation, useNavigate } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";

export const OfficesSection = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { setOpenMobile } = useSidebar();
  const currentSection = new URLSearchParams(location.search).get("section") || "company";

  const handleOfficeClick = (sectionId: string) => {
    const params = new URLSearchParams(location.search);
    params.set("section", sectionId);
    params.delete("room"); // Clear room when changing office
    navigate(`/office?${params.toString()}`);
    setOpenMobile(false);
  };

  return (
    <SidebarGroup className="flex-shrink-0 min-h-[4rem] mb-4">
      <SidebarGroupLabel className="text-[#9b87f5] font-semibold">OFFICES</SidebarGroupLabel>
      <SidebarGroupContent>
        <ScrollArea className="max-h-[30vh]">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="text-white hover:bg-[#E5DEFF] hover:text-[#343A5C] transition-colors"
                isActive={currentSection === "company"}
                onClick={() => handleOfficeClick("company")}
              >
                Company
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="text-white hover:bg-[#E5DEFF] hover:text-[#343A5C] transition-colors"
                isActive={currentSection === "marketing"}
                onClick={() => handleOfficeClick("marketing")}
              >
                Marketing
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="text-white hover:bg-[#E5DEFF] hover:text-[#343A5C] transition-colors"
                isActive={currentSection === "hr"}
                onClick={() => handleOfficeClick("hr")}
              >
                Human Resources
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </ScrollArea>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};