/**
 * The browser's ReceivedFileIO: ReadPulledFileChunk over the agent socket, and the download
 * anchor every saved file in the app goes through (lib/document-files.ts).
 */
import { websocketService } from '@/lib/websocket-service';
import { browserDocumentFiles } from '@/lib/document-files';
import { backendReadPulledChunk } from '@/lib/revfs/revfs-io-read-chunk';
import type { PulledChunk, RevfsIntentResult } from '@/types/revfs-intents';
import type { ReceivedFileAsk, ReceivedFileIO } from './received-file';

async function readChunk(ask: ReceivedFileAsk, offset: bigint, maxLen: number): Promise<PulledChunk> {
  const result: RevfsIntentResult = await backendReadPulledChunk(
    { sendInternalServiceRequest: (request: unknown): Promise<void> => websocketService.sendMessage(request as Record<string, unknown>) },
    { cid: ask.cid, peerCid: ask.peerCid, virtualDir: ask.savedPath, offset, maxLen },
  );
  if (result.type !== 'backend-read-pulled-chunk') throw new Error(`the agent gave a ${result.type} answer`);
  if (result.answer.kind === 'failed') throw new Error(result.answer.message);
  return result.answer.chunk;
}

export const browserReceivedFileIO: ReceivedFileIO = {
  readChunk,
  save: (file): void => browserDocumentFiles.save(file),
};
