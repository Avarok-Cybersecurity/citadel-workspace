/**
 * File Picker Operations
 *
 * Handles native file picker dialog operations via the internal service.
 */

import { eventEmitter } from '../event-emitter';
import { failOnSocketLoss } from './request-response';
import { debugLog } from '../debug-config';
import { TIMEOUT } from '../timeout-constants';

export interface FilePickerConfig {
  init: () => Promise<void>;
  sendRequest: (request: unknown, requestId?: string) => Promise<void>;
}

export interface FilePickerResult {
  file_path: string;
  file_name: string;
  file_size: bigint;
}

export class FilePicker {
  private readonly config: FilePickerConfig;

  constructor(config: FilePickerConfig) {
    this.config = config;
  }

  async pickFile(
    cid: bigint,
    title?: string,
    allowedExtensions?: string[]
  ): Promise<FilePickerResult> {
    await this.config.init();

    const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
    const request: { PickFile: { request_id: `${string}-${string}-${string}-${string}-${string}`; cid: bigint; title: string | null; allowed_extensions: string[] | null; }; } = {
      PickFile: {
        request_id: requestId,
        cid: cid,
        title: title || null,
        allowed_extensions: allowedExtensions || null
      }
    };

    debugLog('FilePicker', 'Sending PickFile request', request);

    return failOnSocketLoss('PickFile', new Promise((resolve, reject) => {
      // Longer timeout for file picker - user interaction can take time
      const timeout: NodeJS.Timeout = setTimeout((): void => {
        eventEmitter.off('websocket-message', handleMessage);
        reject(new Error('File picker timed out'));
      }, TIMEOUT.FILE_PICKER_MS); // 2 minute timeout

      const handleMessage = (message: Record<string, unknown>): void => {
        const msg: { PickFileSuccess?: { request_id: string; file_path: string; file_name: string; file_size: bigint; }; PickFileFailure?: { request_id: string; message?: string; }; } = message as {
          PickFileSuccess?: { request_id: string; file_path: string; file_name: string; file_size: bigint };
          PickFileFailure?: { request_id: string; message?: string };
        };
        if (msg.PickFileSuccess?.request_id === requestId) {
          clearTimeout(timeout);
          eventEmitter.off('websocket-message', handleMessage);
          resolve({
            file_path: msg.PickFileSuccess.file_path,
            file_name: msg.PickFileSuccess.file_name,
            file_size: msg.PickFileSuccess.file_size
          });
        } else if (msg.PickFileFailure?.request_id === requestId) {
          clearTimeout(timeout);
          eventEmitter.off('websocket-message', handleMessage);
          reject(new Error(msg.PickFileFailure.message || 'File picker failed'));
        }
      };

      eventEmitter.on('websocket-message', handleMessage);

      this.config.sendRequest(request, requestId).catch(error => {
        clearTimeout(timeout);
        eventEmitter.off('websocket-message', handleMessage);
        reject(error);
      });
    }));
  }
}
