/**
 * A shared file's bytes and, when they are a picture, the picture: read once, on demand for a
 * download and at once for a likely picture. A picture is shown only when its bytes are one of
 * the five raster formats and its header is within the decode limits (received-files/image-preview),
 * never by its name or declared type, and is drawn from a Blob of its sniffed type.
 */
import { useCallback, useContext, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { SharedFile } from '@/lib/chat/attachments/shared-file';
import { looksLikePicture, pictureOf, type Picture } from '@/lib/received-files/image-preview';
import { blobTypeFor } from '@/lib/received-files/blob-type';
import { safeDownloadName } from '@/lib/received-files/download-name';
import { describeFailure } from '@/lib/failure-message';
import { AttachmentIOContext, type AttachmentIO } from './attachment-io';

export interface SharedFileView {
  /** An object URL of the checked picture, or null. */
  readonly pictureUrl: string | null;
  readonly busy: boolean;
  /** Why the last read failed, as a sentence; null when it did not. */
  readonly failure: string | null;
  /** Null where this conversation cannot read the file. */
  readonly download: (() => void) | null;
}

export function useSharedFile(file: SharedFile): SharedFileView {
  const io: AttachmentIO | null = useContext(AttachmentIOContext);
  const bytes: MutableRefObject<Promise<Uint8Array> | null> = useRef<Promise<Uint8Array> | null>(null);
  const [pictureUrl, setPictureUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [failure, setFailure] = useState<string | null>(null);

  const read: () => Promise<Uint8Array> = useCallback((): Promise<Uint8Array> => {
    if (io === null) return Promise.reject(new Error('This conversation cannot read files.'));
    bytes.current ??= io.read(file);
    // A failed read is not kept, so the next click reads again.
    bytes.current.catch((): void => { bytes.current = null; });
    return bytes.current;
  }, [io, file]);

  useEffect((): (() => void) | void => {
    if (io === null || !looksLikePicture(file.name, file.mime, file.size)) return;
    let url: string | null = null;
    let live: boolean = true;
    read().then((data: Uint8Array): void => {
      const picture: Picture | string = pictureOf(data);
      if (!live || typeof picture === 'string') return;
      url = URL.createObjectURL(new Blob([data.slice().buffer], { type: picture.mime }));
      setPictureUrl(url);
    }).catch((): void => undefined); // The download says why, if the person asks for it.
    return (): void => {
      live = false;
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [io, file, read]);

  const download: () => void = useCallback((): void => {
    if (io === null) return;
    setBusy(true);
    setFailure(null);
    read()
      .then((data: Uint8Array): void => io.files.save({ bytes: data, mime: blobTypeFor(data, file.name), name: safeDownloadName(file.name) }))
      .catch((error: unknown): void => setFailure(describeFailure(error, 'The file could not be read from the server.')))
      .finally((): void => setBusy(false));
  }, [io, file, read]);

  return { pictureUrl, busy, failure, download: io === null ? null : download };
}
