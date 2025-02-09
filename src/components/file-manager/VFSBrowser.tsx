
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ArrowLeft, Folder, FileText, ChevronRight } from "lucide-react";
import type { FileSystemNode } from "@/types/files";

interface VFSBrowserProps {
  onBack: () => void;
  onFileSelect: (file: FileSystemNode) => void;
  initialPath?: string;
}

const filesystem: FileSystemNode = {
  name: "/",
  type: "directory",
  path: "/",
  children: [
    {
      name: "home",
      type: "directory",
      path: "/home",
      children: [
        {
          name: "alice",
          type: "directory",
          path: "/home/alice",
          children: [
            {
              name: "documents",
              type: "directory",
              path: "/home/alice/documents",
              children: [
                {
                  name: "secure.pdf",
                  type: "file",
                  path: "/home/alice/documents/secure.pdf",
                }
              ]
            }
          ]
        }
      ]
    }
  ]
};

const findNodeByPath = (root: FileSystemNode, path: string): FileSystemNode | null => {
  if (root.path === path) return root;
  if (!root.children) return null;
  
  for (const child of root.children) {
    const found = findNodeByPath(child, path);
    if (found) return found;
  }
  
  return null;
};

const getParentPath = (path: string): string => {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return '/' + parts.join('/');
};

export const VFSBrowser = ({ onBack, onFileSelect }: VFSBrowserProps) => {
  const [currentPath, setCurrentPath] = useState("/");
  const [pathInput, setPathInput] = useState("/");
  
  const currentNode = findNodeByPath(filesystem, currentPath) || filesystem;
  
  const handleNavigate = (path: string) => {
    setCurrentPath(path);
    setPathInput(path);
  };

  const handleGoBack = () => {
    if (currentPath === "/") {
      onBack();
    } else {
      const parentPath = getParentPath(currentPath);
      handleNavigate(parentPath);
    }
  };

  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const node = findNodeByPath(filesystem, pathInput);
    if (node) {
      setCurrentPath(pathInput);
    }
  };

  const renderNode = (node: FileSystemNode) => (
    <ContextMenu key={node.path}>
      <ContextMenuTrigger>
        <div
          className="flex items-center gap-2 p-2 hover:bg-[#343A5C] rounded-lg cursor-pointer"
          onClick={() => {
            if (node.type === "directory") {
              handleNavigate(node.path);
            } else {
              onFileSelect(node);
            }
          }}
        >
          {node.type === "directory" ? (
            <Folder className="h-4 w-4 text-[#9b87f5]" />
          ) : (
            <FileText className="h-4 w-4 text-[#9b87f5]" />
          )}
          <span>{node.name}</span>
          {node.type === "directory" && (
            <ChevronRight className="h-4 w-4 ml-auto text-gray-400" />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="bg-[#343A5C] border-[#262C4A] text-white">
        <ContextMenuItem
          className="hover:bg-[#444A6C] cursor-pointer"
          onClick={() => {
            if (node.type === "file") {
              onFileSelect(node);
            }
          }}
        >
          Open
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );

  return (
    <div className="h-full flex flex-col animate-slide-in">
      <div className="flex items-center gap-4 p-4 bg-[#343A5C]">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleGoBack}
          className="hover:bg-[#444A6C]"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <form onSubmit={handlePathSubmit} className="flex-1">
          <Input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            className="bg-[#262C4A] border-[#444A6C] text-white"
          />
        </form>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {currentNode.children?.map(renderNode)}
        </div>
      </ScrollArea>
    </div>
  );
};
