/**
 * The file manager's top bar: which storage (a segmented P2P / Server switch,
 * with the peer inside P2P), a filter for the open folder, the transfers button
 * and New.
 */
import { ArrowUpDown, ChevronDown, FolderPlus, Plus, Search, Server, Share2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { StorageRef } from '@/lib/file-manager-location';
import type { OpenableStorage } from './useFileManagerPlace';
import type { StoragePeer } from './storage-peers';
import { StoragePeerMenuItems } from './StoragePeerMenu';
import type { UploadAvailability } from './upload-refusal';

export interface FileManagerTopBarProps {
  storage: StorageRef;
  peers: readonly StoragePeer[];
  peersLoading: boolean;
  /** The open peer's name, or null when no peer storage is open. */
  peerName: string | null;
  onOpenStorage: (storage: OpenableStorage) => void;
  /** Null while there is no folder on screen to filter or add to. */
  folder: {
    filterText: string;
    onFilterChange: (text: string) => void;
    onNewFolder: () => void;
    onUpload: () => void;
    /** Offered, disabled with why (this folder), or absent with why (the storage takes no files). */
    upload: UploadAvailability;
  } | null;
  transfers: { active: number; open: boolean; onToggle: () => void };
}

const SEGMENT: string = 'inline-flex h-[30px] items-center gap-[6px] rounded-[5px] px-[10px] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const ON: string = 'bg-primary text-primary-foreground';
const OFF: string = 'text-muted-foreground hover:bg-surface hover:text-foreground';

function StorageSwitch({ storage, peers, peersLoading, peerName, onOpenStorage }: Omit<FileManagerTopBarProps, 'folder' | 'transfers'>): JSX.Element {
  const isServer: boolean = storage.kind === 'server';
  const isP2P: boolean = !isServer;
  const selected: bigint | null = storage.kind === 'peer' ? storage.cid : null;
  const choose = (cid: bigint): void => onOpenStorage({ kind: 'peer', cid });
  const pickerLabel: string = peerName === null ? 'Choose a peer' : `Peer: ${peerName}. Choose another`;
  const menu: JSX.Element = <StoragePeerMenuItems peers={peers} loading={peersLoading} selected={selected} onChoose={choose} />;
  return (
    <div className="flex min-w-0 items-center gap-[8px]">
      <div className="inline-flex shrink-0 items-center gap-[4px] rounded-[7px] border border-border bg-background p-[2px]" role="group" aria-label="Storage">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn(SEGMENT, isP2P ? ON : OFF)} aria-pressed={isP2P} aria-label="P2P Storage, end-to-end encrypted" data-testid="storage-p2p">
              <Share2 className="h-[14px] w-[14px]" aria-hidden="true" />P2P<span className="hidden sm:inline">Storage</span>
              <span className={cn('rounded-[3px] border px-[4px] text-xs font-semibold', isP2P ? 'border-primary-foreground/60' : 'border-transparent bg-surface')}>E2E</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[280px]">{menu}</DropdownMenuContent>
        </DropdownMenu>
        <button type="button" className={cn(SEGMENT, isServer ? ON : OFF)} aria-pressed={isServer} aria-label="Server Storage" onClick={() => onOpenStorage({ kind: 'server' })} data-testid="storage-server">
          <Server className="h-[14px] w-[14px]" aria-hidden="true" />Server<span className="hidden sm:inline">Storage</span>
        </button>
      </div>
      {isP2P && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-[32px] min-w-0 max-w-[200px] gap-[6px] px-[10px] text-sm" aria-label={pickerLabel} data-testid="storage-peer-picker">
              <span className="truncate">{peerName ?? 'Choose a peer'}</span>
              <ChevronDown className="h-[14px] w-[14px] shrink-0" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[280px]">{menu}</DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export function FileManagerTopBar(props: FileManagerTopBarProps): JSX.Element {
  const { folder, transfers } = props;
  const transfersLabel: string = transfers.active > 0 ? `Transfers, ${transfers.active} active` : 'Transfers';
  return (
    <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px] border-b border-border bg-card px-[16px] py-[10px]">
      <StorageSwitch storage={props.storage} peers={props.peers} peersLoading={props.peersLoading} peerName={props.peerName} onOpenStorage={props.onOpenStorage} />
      {folder && (
        <div className="relative order-last w-full md:order-none md:ml-auto md:w-[280px] lg:w-[340px]">
          <Search className="pointer-events-none absolute left-[10px] top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search" value={folder.filterText} onChange={(e) => folder.onFilterChange(e.target.value)}
            placeholder="Filter this folder" aria-label="Filter this folder"
            className="h-[32px] w-full bg-background pl-[30px] pr-[30px] text-sm"
          />
          {folder.filterText && (
            <button type="button" aria-label="Clear filter" onClick={() => folder.onFilterChange('')}
              className="absolute right-[4px] top-1/2 grid h-[24px] w-[24px] -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground">
              <X className="h-[13px] w-[13px]" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      <div className="ml-auto flex items-center gap-[8px] md:ml-0">
        <Button
          variant="outline" size="icon" className="relative h-[32px] w-[32px]" onClick={transfers.onToggle}
          aria-expanded={transfers.open} aria-controls="vfs-transfers"
          aria-label={transfersLabel} data-testid="vfs-transfers-button"
        >
          <ArrowUpDown className="h-[15px] w-[15px]" aria-hidden="true" />
          {transfers.active > 0 && (
            <span className="absolute -right-[6px] -top-[6px] grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-[4px] text-xs font-bold text-primary-foreground" aria-hidden="true">
              {transfers.active}
            </span>
          )}
        </Button>
        {folder && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="h-[32px] gap-[6px] px-[12px] text-sm" data-testid="vfs-new"><Plus className="h-[15px] w-[15px]" aria-hidden="true" />New</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={folder.onNewFolder} className="cursor-pointer" data-testid="vfs-new-folder"><FolderPlus className="mr-2 h-4 w-4" aria-hidden="true" />New folder</DropdownMenuItem>
              {folder.upload.kind !== 'absent' && (
                <DropdownMenuItem onSelect={folder.onUpload} disabled={folder.upload.kind === 'disabled'} className="cursor-pointer" data-testid="vfs-new-upload">
                  <Upload className="mr-2 h-4 w-4" aria-hidden="true" />Upload files
                </DropdownMenuItem>
              )}
              {folder.upload.kind !== 'offered' && <p data-testid="vfs-upload-unavailable" className="max-w-[240px] px-2 py-1.5 text-xs text-muted-foreground">{folder.upload.reason}</p>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
