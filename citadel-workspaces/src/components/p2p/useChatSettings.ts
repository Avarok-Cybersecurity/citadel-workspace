import { useState, useEffect, useCallback } from 'react';
import { useEventListener } from '@/hooks/use-event-listener';
import { FILE_TRANSFER_EVENTS } from '@/lib/file-transfer/events';
import { completedTransferCount } from '@/lib/file-transfer/account-history';
import { p2pMessengerManager } from '@/lib/p2p';
import { fileTransferService, type FileTransferSettings } from '@/lib/file-transfer';
import type { ConversationMetadata } from '@/lib/p2p/p2p-types';
import type { FileTransfer } from '@/lib/file-transfer/types';
import { conversationFacts, type ConversationFacts } from './connection-facts';
import type { Dispatch, SetStateAction } from 'react';
import {
  FILE_TRANSFER_DEFAULT_MAX_SIZE_BYTES,
  REVFS_DEFAULT_QUOTA_BYTES
} from '@/types/messaging-layer';

export function useChatSettings(isOpen: boolean, peerCid: string): { stats: { messages: number; files: number } & ConversationFacts; activeOuterTab: string; setActiveOuterTab: Dispatch<SetStateAction<string>>; activeFileTab: string; setActiveFileTab: Dispatch<SetStateAction<string>>; settings: FileTransferSettings; maxFileSizeMb: number; revfsQuotaMb: number; defaultMaxMb: number; formatSizeLimit: (bytes: number) => string; handleAutoAcceptChange: (enabled: boolean) => Promise<void>; handleMaxFileSizeChange: (values: number[]) => Promise<void>; handleAllowRevfsChange: (allowed: boolean) => Promise<void>; handleRevfsQuotaChange: (values: number[]) => Promise<void>; } {
  const [activeOuterTab, setActiveOuterTab] = useState('general');
  const [activeFileTab, setActiveFileTab] = useState('standard');
  const [settings, setSettings] = useState<FileTransferSettings>({
    autoAccept: false,
    autoAcceptAnswered: false,
    maxFileSize: FILE_TRANSFER_DEFAULT_MAX_SIZE_BYTES,
    allowRevfsStorage: false,
    revfsQuota: REVFS_DEFAULT_QUOTA_BYTES,
  });

  /**
   * Real conversation statistics.
   *
   * The Stats tab used to read `p2p-messages:{cid}` and `file-transfers:{cid}`
   * straight out of localStorage. Neither key is written ANYWHERE in this app —
   * each appeared exactly once, in the read itself — so both panels reported 0
   * for every conversation, however long. A confidently-rendered "0 Messages"
   * over a thread full of them is worse than showing nothing.
   *
   * totalMessageCount is the count the pagination store maintains (incremented
   * per stored message); deleting a conversation removes its metadata, so a
   * cleared thread correctly reads back as 0 again.
   */
  const [messages, setMessages] = useState<number>(0);
  // Finished transfers only, recounted as they change: the count was every
  // record of any state, taken once when the panel opened.
  const [transfers, setTransfers] = useState<FileTransfer[]>([]);
  const [oldestMessage, setOldestMessage] = useState<number | null>(null);
  const recountFiles: () => void = useCallback((): void => {
    if (!isOpen || !peerCid) return;
    setTransfers(fileTransferService.getTransfersForPeer(peerCid));
  }, [isOpen, peerCid]);
  useEffect(recountFiles, [recountFiles]);
  useEventListener(FILE_TRANSFER_EVENTS.STATE_CHANGED, recountFiles);

  useEffect(() => {
    if (!isOpen || !peerCid) return;
    let cancelled: boolean = false;
    void (async (): Promise<void> => {
      try {
        const metadata: ConversationMetadata | null = await p2pMessengerManager.getConversationMetadata(BigInt(peerCid));
        if (!cancelled) { setMessages(metadata?.totalMessageCount ?? 0); setOldestMessage(metadata?.oldestMessageTimestamp ?? null); }
      } catch {
        // A conversation with no stored history has no metadata; 0 is correct.
        if (!cancelled) setMessages(0);
      }
    })();
    return (): void => { cancelled = true; };
  }, [isOpen, peerCid]);
  const stats: { messages: number; files: number } & ConversationFacts = {
    messages, files: completedTransferCount(transfers), ...conversationFacts(oldestMessage, transfers),
  };

  useEffect(() => {
    if (isOpen && peerCid) {
      const currentSettings: FileTransferSettings = fileTransferService.getSettings(peerCid);
      setSettings(currentSettings);
    }
  }, [isOpen, peerCid]);

  // Deliberately always megabytes, because it labels a size LIMIT the user set
  // in megabytes -- rendering "1 GB" beside a slider marked in MB reads as a
  // different setting. Renamed off formatBytes so it stops looking like the
  // general formatter it is not.
  const formatSizeLimit = (bytes: number): string => {
    if (bytes === 0) return '0 MB';
    const mb: number = bytes / (1024 * 1024);
    return `${Math.round(mb)} MB`;
  };

  const handleAutoAcceptChange = async (enabled: boolean): Promise<void> => {
    setSettings(prev => ({ ...prev, autoAccept: enabled }));
    await fileTransferService.setAutoAccept(peerCid, enabled);
  };

  const handleMaxFileSizeChange = async (values: number[]): Promise<void> => {
    const bytes: number = values[0] * 1024 * 1024;
    setSettings(prev => ({ ...prev, maxFileSize: bytes }));
    await fileTransferService.setMaxFileSize(peerCid, bytes);
  };

  const handleAllowRevfsChange = async (allowed: boolean): Promise<void> => {
    setSettings(prev => ({ ...prev, allowRevfsStorage: allowed }));
    await fileTransferService.setAllowRevfsStorage(peerCid, allowed);
  };

  const handleRevfsQuotaChange = async (values: number[]): Promise<void> => {
    const bytes: number = values[0] * 1024 * 1024;
    setSettings(prev => ({ ...prev, revfsQuota: bytes }));
    await fileTransferService.setRevfsQuota(peerCid, bytes);
  };

  const maxFileSizeMb: number = Math.round(settings.maxFileSize / (1024 * 1024));
  const revfsQuotaMb: number = Math.round(settings.revfsQuota / (1024 * 1024));
  const defaultMaxMb: number = Math.round(FILE_TRANSFER_DEFAULT_MAX_SIZE_BYTES / (1024 * 1024));

  return {
    stats,
    activeOuterTab,
    setActiveOuterTab,
    activeFileTab,
    setActiveFileTab,
    settings,
    maxFileSizeMb,
    revfsQuotaMb,
    defaultMaxMb,
    formatSizeLimit,
    handleAutoAcceptChange,
    handleMaxFileSizeChange,
    handleAllowRevfsChange,
    handleRevfsQuotaChange,
  };
}
