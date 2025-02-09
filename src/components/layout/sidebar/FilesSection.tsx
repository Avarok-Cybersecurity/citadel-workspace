import { FileSpreadsheet, FileText, FileType, FileCode, Folder } from "lucide-react";
import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { FilePreviewDialog } from "./FilePreviewDialog";
import { useNavigate, useLocation } from "react-router-dom";

export const files = [
  {
    id: "q4-report",
    name: "Q4 Report.pdf",
    type: "Portable Document Format (PDF)",
    size: 8834000,
    sender: {
      name: "David Anderson",
      avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e"
    },
    createdAt: "7:13 PM EST - March 16, 2024",
    url: "/files/Q4 Report.pdf"
  },
  {
    id: "project-timeline",
    name: "Project Timeline.xlsx",
    type: "Microsoft Excel Spreadsheet",
    size: 2450000,
    sender: {
      name: "Sarah Miller",
      avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80"
    },
    createdAt: "2:30 PM EST - March 15, 2024",
    url: "/files/Project Timeline.xlsx"
  },
  {
    id: "meeting-notes",
    name: "Meeting Notes.docx",
    type: "Microsoft Word Document",
    size: 1250000,
    sender: {
      name: "John Cooper",
      avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e"
    },
    createdAt: "11:45 AM EST - March 14, 2024",
    url: "/files/Meeting Notes.docx"
  }
];

const getFileIcon = (fileName: string) => {
  const extension = fileName.split('.').pop()?.toLowerCase();
  
  switch (extension) {
    case 'xlsx':
    case 'xls':
      return <FileSpreadsheet className="h-4 w-4" />;
    case 'pdf':
      return <FileType className="h-4 w-4" />;
    case 'md':
    case 'mdx':
    case 'txt':
    case 'doc':
    case 'docx':
    case 'odt':
      return <FileText className="h-4 w-4" />;
    default:
      return <FileCode className="h-4 w-4" />;
  }
};

export const FilesSection = () => {
  const [selectedFile, setSelectedFile] = useState<typeof files[0] | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const handleFileClick = (file: typeof files[0]) => {
    setSelectedFile(file);
    setIsPreviewOpen(true);
  };

  const handleClosePreview = () => {
    setIsPreviewOpen(false);
    setSelectedFile(null);
  };

  const handleFileManagerClick = () => {
    const params = new URLSearchParams(location.search);
    params.set('section', 'files');
    navigate(`/office?${params.toString()}`);
  };

  return (
    <>
      <SidebarGroup className="flex-shrink-0 min-h-[4rem]">
        <SidebarGroupLabel className="text-[#9b87f5] font-semibold">FILES</SidebarGroupLabel>
        <SidebarGroupContent>
          <ScrollArea className="max-h-[30vh]">
            <SidebarMenu>
              {files.map((file) => (
                <SidebarMenuItem key={file.id}>
                  <SidebarMenuButton 
                    className="text-white hover:bg-[#E5DEFF] hover:text-[#343A5C] transition-colors"
                    onClick={() => handleFileClick(file)}
                  >
                    {getFileIcon(file.name)}
                    <span>{file.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <SidebarMenuItem>
                <SidebarMenuButton 
                  className="text-white hover:bg-[#E5DEFF] hover:text-[#343A5C] transition-colors"
                  onClick={handleFileManagerClick}
                >
                  <Folder className="h-4 w-4" />
                  <span>File Manager</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </ScrollArea>
        </SidebarGroupContent>
      </SidebarGroup>

      <FilePreviewDialog
        file={selectedFile}
        isOpen={isPreviewOpen}
        onClose={handleClosePreview}
      />
    </>
  );
};
