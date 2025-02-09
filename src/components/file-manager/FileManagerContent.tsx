
import { useState } from "react";
import { FilePreviewDialog } from "@/components/layout/sidebar/FilePreviewDialog";
import { toast } from "sonner";
import type { FileMetadata } from "@/types/files";
import { files as sidebarFiles } from "@/components/layout/sidebar/FilesSection";
import { FileManagerTabs } from "./FileManagerTabs";
import { DeleteDialog } from "./DeleteDialog";
import { ClearAllDialog } from "./ClearAllDialog";
import { VFSBrowser } from "./VFSBrowser";

const standardFiles = sidebarFiles.map(file => ({
  ...file,
  transferType: 'standard' as const,
}));

const mockRevfsFiles = [
  {
    id: "revfs-1",
    name: "Secure Document.pdf",
    type: "PDF Document",
    size: 1500000,
    sender: {
      name: "Alice Smith",
      avatar: "https://github.com/shadcn.png"
    },
    receiver: {
      name: "Bob Johnson",
      avatar: "https://github.com/shadcn.png"
    },
    createdAt: "2024-03-20T15:30:00Z",
    url: "/files/secure.pdf",
    transferType: "revfs" as const,
    status: "pending" as const,
    virtualPath: "/home/alice/documents/secure.pdf",
    isLocallyStored: true
  }
];

const allFiles = [...standardFiles, ...mockRevfsFiles];

export const FileManagerContent = () => {
  const [selectedFile, setSelectedFile] = useState<FileMetadata | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [files, setFiles] = useState(allFiles);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showClearAllDialog, setShowClearAllDialog] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<FileMetadata | null>(null);
  const [dontAskDelete, setDontAskDelete] = useState(false);
  const [dontAskClearAll, setDontAskClearAll] = useState(false);
  const [clearAllType, setClearAllType] = useState<'standard' | 'revfs'>('standard');
  const [showVFSBrowser, setShowVFSBrowser] = useState(false);

  const handleFileClick = (file: FileMetadata) => {
    if (file.transferType === 'revfs') {
      setShowVFSBrowser(true);
    } else {
      setSelectedFile(file);
      setIsPreviewOpen(true);
    }
  };

  const handleDelete = (file: FileMetadata) => {
    if (dontAskDelete) {
      confirmDelete(file);
    } else {
      setFileToDelete(file);
      setShowDeleteDialog(true);
    }
  };

  const confirmDelete = (file: FileMetadata) => {
    setFiles(prev => prev.filter(f => f.id !== file.id));
    toast.success(`Deleted file: ${file.name}`);
  };

  const handleClearAll = (type: 'standard' | 'revfs') => {
    if (dontAskClearAll) {
      confirmClearAll(type);
    } else {
      setClearAllType(type);
      setShowClearAllDialog(true);
    }
  };

  const confirmClearAll = (type: 'standard' | 'revfs') => {
    setFiles(prev => prev.filter(f => f.transferType !== type));
    toast.success(`All ${type} files cleared`);
  };

  if (showVFSBrowser) {
    return (
      <div className="h-full bg-[#444A6C]">
        <VFSBrowser
          onBack={() => setShowVFSBrowser(false)}
          onFileSelect={(file) => {
            const matchingFile = mockRevfsFiles.find(f => f.virtualPath === file.path);
            if (matchingFile) {
              setSelectedFile(matchingFile);
              setIsPreviewOpen(true);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-6 bg-[#444A6C] min-h-screen">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-6">File Manager</h1>
        
        <FileManagerTabs
          files={files}
          onFileClick={handleFileClick}
          onDelete={handleDelete}
          onClearAll={handleClearAll}
        />
      </div>

      <FilePreviewDialog
        file={selectedFile}
        isOpen={isPreviewOpen}
        onClose={() => {
          setIsPreviewOpen(false);
          setSelectedFile(null);
          setShowVFSBrowser(false);
        }}
      />

      <DeleteDialog
        showDialog={showDeleteDialog}
        setShowDialog={setShowDeleteDialog}
        fileToDelete={fileToDelete}
        dontAskDelete={dontAskDelete}
        setDontAskDelete={setDontAskDelete}
        onConfirmDelete={confirmDelete}
      />

      {!showVFSBrowser && (
        <ClearAllDialog
          showDialog={showClearAllDialog}
          setShowDialog={setShowClearAllDialog}
          clearAllType={clearAllType}
          dontAskClearAll={dontAskClearAll}
          setDontAskClearAll={setDontAskClearAll}
          onConfirmClearAll={confirmClearAll}
        />
      )}
    </div>
  );
};
