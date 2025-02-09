import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar, Download, FileSpreadsheet, FileText, FileType, FileCode, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatFileSize } from "@/lib/utils";
import { useState } from "react";

interface FileDetails {
  id: string;
  name: string;
  type: string;
  size: number;
  sender: {
    name: string;
    avatar: string;
  };
  createdAt: string;
  url: string;
}

interface FilePreviewDialogProps {
  file: FileDetails | null;
  isOpen: boolean;
  onClose: () => void;
}

const getFileIcon = (fileName: string) => {
  const extension = fileName.split('.').pop()?.toLowerCase();
  
  switch (extension) {
    case 'xlsx':
    case 'xls':
      return <FileSpreadsheet className="h-5 w-5 text-gray-300" />;
    case 'pdf':
      return <FileType className="h-5 w-5 text-gray-300" />;
    case 'md':
    case 'mdx':
    case 'txt':
    case 'doc':
    case 'docx':
    case 'odt':
      return <FileText className="h-5 w-5 text-gray-300" />;
    default:
      return <FileCode className="h-5 w-5 text-gray-300" />;
  }
};

const renderFilePreview = (file: FileDetails) => {
  const extension = file.name.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'pdf':
      return (
        <iframe
          src={`${file.url}#toolbar=0`}
          className="w-full h-[600px] rounded-lg"
          title={file.name}
        />
      );
    case 'txt':
    case 'md':
    case 'mdx':
      return (
        <div className="w-full max-h-[600px] overflow-auto bg-[#343A5C] p-4 rounded-lg">
          <pre className="text-white whitespace-pre-wrap">{file.url}</pre>
        </div>
      );
    case 'xlsx':
    case 'xls':
      return (
        <iframe
          src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(file.url)}`}
          className="w-full h-[600px] rounded-lg"
          title={file.name}
        />
      );
    case 'doc':
    case 'docx':
    case 'odt':
      return (
        <iframe
          src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(file.url)}`}
          className="w-full h-[600px] rounded-lg"
          title={file.name}
        />
      );
    default:
      return (
        <div className="text-center p-8 bg-[#343A5C] rounded-lg">
          <FileCode className="mx-auto h-12 w-12 text-gray-300 mb-4" />
          <p className="text-white">Preview not available for this file type</p>
        </div>
      );
  }
};

export const FilePreviewDialog = ({ file, isOpen, onClose }: FilePreviewDialogProps) => {
  const [showPreview, setShowPreview] = useState(false);

  if (!file) return null;

  const handlePreview = () => {
    setShowPreview(true);
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = file.url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#444A6C] border-[#262C4A] text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider">
            {getFileIcon(file.name)}
            File Preview
          </DialogTitle>
        </DialogHeader>

        {showPreview ? (
          <div className="space-y-4">
            {renderFilePreview(file)}
            <div className="flex justify-end">
              <Button
                onClick={() => setShowPreview(false)}
                className="bg-[#E5DEFF] text-[#343A5C] hover:bg-[#E5DEFF]/90"
              >
                Back to Details
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-[#343A5C] rounded-lg p-4">
              <div className="flex flex-col space-y-6">
                <div className="text-center">
                  <div className="text-sm text-gray-300 mb-2 uppercase tracking-wider flex items-center justify-center gap-2">
                    <User className="h-5 w-5" />
                    Sent by
                  </div>
                  <div className="inline-flex items-center gap-3 bg-[#444A6C] rounded-full px-6 py-2">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={file.sender.avatar} />
                      <AvatarFallback>{file.sender.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <span className="text-lg font-medium">{file.sender.name}</span>
                  </div>
                </div>

                <div className="text-center">
                  <div className="text-sm text-gray-300 mb-2 uppercase tracking-wider flex items-center justify-center gap-2">
                    {getFileIcon(file.name)}
                    Filename
                  </div>
                  <div className="bg-[#444A6C] rounded-full px-6 py-2">
                    {file.name}
                  </div>
                </div>

                <div className="text-center">
                  <div className="text-sm text-gray-300 mb-2 uppercase tracking-wider flex items-center justify-center gap-2">
                    <Calendar className="h-5 w-5" />
                    Create Date
                  </div>
                  <div className="bg-[#444A6C] rounded-full px-6 py-2">
                    {file.createdAt}
                  </div>
                </div>

                <div className="text-center">
                  <div className="text-sm text-gray-300 mb-2 uppercase tracking-wider flex items-center justify-center gap-2">
                    {getFileIcon(file.name)}
                    File Type
                  </div>
                  <div className="bg-[#444A6C] rounded-full px-6 py-2">
                    {file.type}
                  </div>
                </div>

                <div className="text-center">
                  <div className="text-sm text-gray-300 mb-2 uppercase tracking-wider flex items-center justify-center gap-2">
                    {getFileIcon(file.name)}
                    File Size
                  </div>
                  <div className="bg-[#444A6C] rounded-full px-6 py-2">
                    {formatFileSize(file.size)}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                onClick={handlePreview}
                className="bg-[#E5DEFF] text-[#343A5C] hover:bg-[#E5DEFF]/90"
              >
                Preview
              </Button>
              <Button
                onClick={handleDownload}
                className="bg-[#E5DEFF] text-[#343A5C] hover:bg-[#E5DEFF]/90"
              >
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};