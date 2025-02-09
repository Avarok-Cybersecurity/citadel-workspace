export interface FileMetadata {
  id: string;
  name: string;
  type: string;
  size: number;
  sender: {
    name: string;
    avatar: string;
  };
  receiver?: {
    name: string;
    avatar: string;
  };
  createdAt: string;
  url: string;
  transferType: 'standard' | 'revfs';
  status?: 'pending' | 'accepted' | 'denied';
  virtualPath?: string;
  isLocallyStored?: boolean;
}

export interface FileSystemNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileSystemNode[];
  metadata?: FileMetadata;
}