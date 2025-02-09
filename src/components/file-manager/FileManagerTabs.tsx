
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { FileList } from "./FileList";
import type { FileMetadata } from "@/types/files";

interface FileManagerTabsProps {
  files: FileMetadata[];
  onFileClick: (file: FileMetadata) => void;
  onDelete: (file: FileMetadata) => void;
  onClearAll: (type: 'standard' | 'revfs') => void;
}

export const FileManagerTabs = ({ files, onFileClick, onDelete, onClearAll }: FileManagerTabsProps) => {
  return (
    <Tabs defaultValue="standard" className="w-full">
      <TabsList className="grid w-full grid-cols-2 bg-[#343A5C]">
        <TabsTrigger
          value="standard"
          className="data-[state=active]:bg-[#E5DEFF] data-[state=active]:text-[#343A5C]"
        >
          Standard Files
        </TabsTrigger>
        <TabsTrigger
          value="revfs"
          className="data-[state=active]:bg-[#E5DEFF] data-[state=active]:text-[#343A5C]"
        >
          RE-VFS Files
        </TabsTrigger>
      </TabsList>
      
      <TabsContent value="standard" className="mt-6">
        <div className="bg-[#262C4A]/95 rounded-lg p-4">
          <div className="flex justify-end mb-4">
            <Button
              variant="outline"
              onClick={() => onClearAll('standard')}
              className="bg-[#E5DEFF] text-[#343A5C] hover:bg-[#E5DEFF]/90"
            >
              Clear All
            </Button>
          </div>
          <ScrollArea className="h-[600px]">
            <FileList
              files={files}
              type="standard"
              onFileClick={onFileClick}
              onDelete={onDelete}
            />
          </ScrollArea>
        </div>
      </TabsContent>
      
      <TabsContent value="revfs" className="mt-6">
        <div className="bg-[#262C4A]/95 rounded-lg p-4">
          <ScrollArea className="h-[600px]">
            <FileList
              files={files}
              type="revfs"
              onFileClick={onFileClick}
              onDelete={onDelete}
            />
          </ScrollArea>
        </div>
      </TabsContent>
    </Tabs>
  );
};
