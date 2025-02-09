import { useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { TopBar } from "./sidebar/TopBar";
import { OfficesSection } from "./sidebar/OfficesSection";
import { RoomsSection } from "./sidebar/RoomsSection";
import { MessagesSection } from "./sidebar/MessagesSection";
import { FilesSection } from "./sidebar/FilesSection";

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout = ({ children }: AppLayoutProps) => {
  const [currentWorkspace] = useState("AVAROK CYBERSECURITY");

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-[#444A6C] text-white">
        <TopBar currentWorkspace={currentWorkspace} />

        <Sidebar className="pt-14 bg-[#262C4A]/95 transition-transform duration-300 ease-in-out">
          <SidebarContent>
            <OfficesSection />
            <RoomsSection />
            <MessagesSection />
            <FilesSection />
          </SidebarContent>
        </Sidebar>

        <div className="flex-1 pt-14 pl-0 overflow-x-hidden">
          {children}
        </div>
      </div>
    </SidebarProvider>
  );
};