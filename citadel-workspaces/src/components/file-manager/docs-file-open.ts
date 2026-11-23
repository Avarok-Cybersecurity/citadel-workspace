/**
 * Where a file manager file's bytes come from when an app opens it (whether one is offered at all
 * is file-openers' decision): the agent pulls it, then hands the bytes to the page
 * (pulled-file-reader.ts).
 */
import type { RevfsNode } from '@/types/revfs-types';
import { readPulledFile, type PulledFileIO } from './pulled-file-reader';

/** Where a stored file's bytes come from, for an app that opens them in the page. */
export interface WorkspaceFileReader {
  read(node: RevfsNode): Promise<Uint8Array>;
}

/** The product's reader: the agent pulls the file (DownloadFile), then hands its bytes over (ReadPulledFileChunk). */
export function agentFileReader(io: PulledFileIO): WorkspaceFileReader {
  return { read: (node: RevfsNode): Promise<Uint8Array> => readPulledFile(node, io) };
}
