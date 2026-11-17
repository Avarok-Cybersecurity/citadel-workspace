/**
 * What the FILES list and its dialog show about a file that reached this agent.
 *
 * Two kinds of file arrive: a P2P transfer someone sent, and a file this
 * account pulled back out of RE-VFS storage. The list showed only the first, so
 * a pull that landed byte-identical in the agent's data dir left the sidebar
 * saying "No downloaded files yet". Both now map to one shape here, which the
 * sidebar and the file manager's "Show" action share, and which replaces the
 * two hand-copied interfaces the sidebar and its dialog each declared.
 */
import { peerDisplayName } from '@/lib/peer-display';
import { formatDateTime } from '@/lib/format-time';
import type { FileTransfer } from '@/lib/file-transfer';
import type { RevfsDownloadRecord } from '@/lib/revfs/download-history';

export interface FileDetails {
  id: string;
  name: string;
  type: string;
  size: number;
  /** `username` is set when the source is a person, so their picture can be drawn; a label is not one. */
  sender: { name: string; username?: string };
  /** How the file came to be here, as a sentence: "Sent by Bob". */
  provenance: string;
  createdAt: string;
  /** Where the agent saved it, on the agent's filesystem. Not a URL. */
  savedTo: string;
}

/** A row and the moment it arrived, so two sources can be ordered together. */
export interface DatedFileDetails {
  at: number;
  details: FileDetails;
}

export function transferDetails(
  transfer: FileTransfer,
  usernameForCid: (cid: string) => string | undefined,
): DatedFileDetails {
  const name: string = peerDisplayName({ cid: transfer.senderCid, username: usernameForCid(transfer.senderCid) });
  return {
    at: transfer.updatedAt,
    details: {
      id: transfer.id,
      name: transfer.fileName,
      type: transfer.fileType || 'Unknown',
      size: transfer.fileSize,
      sender: { name, username: usernameForCid(transfer.senderCid) },
      provenance: `Sent by ${name}`,
      createdAt: formatDateTime(transfer.updatedAt),
      savedTo: transfer.downloadPath ?? '',
    },
  };
}

export function revfsDownloadDetails(record: RevfsDownloadRecord): DatedFileDetails {
  return {
    at: record.downloadedAt,
    details: {
      id: record.id,
      name: record.fileName,
      type: record.fileType || 'Unknown',
      size: record.fileSize,
      sender: { name: record.sourceLabel },
      provenance: `Downloaded from ${record.sourceLabel}`,
      createdAt: formatDateTime(record.downloadedAt),
      savedTo: record.savedTo,
    },
  };
}

/** Most recent first, across both sources. */
export function newestFirst(rows: DatedFileDetails[]): FileDetails[] {
  return [...rows].sort((a: DatedFileDetails, b: DatedFileDetails): number => b.at - a.at)
    .map((row: DatedFileDetails): FileDetails => row.details);
}
