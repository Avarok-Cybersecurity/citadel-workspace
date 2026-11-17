/**
 * A picture sent in the chat, shown in its bubble: the picture itself, bounded, and a button
 * that opens it full size (PictureViewer). Received pictures are read from the agent once they
 * have arrived; this tab's own sends from the file it picked; otherwise the sender's thumbnail,
 * when it is a raster picture. Anything else shows no picture and the bubble keeps its icon.
 */
import { useState } from 'react';
import { fileTransferService } from '@/lib/file-transfer';
import { looksLikePicture, safeThumbnail } from '@/lib/received-files/image-preview';
import type { FileTransfer } from '@/lib/file-transfer/types';
import type { PictureLoad } from '@/lib/received-files/picture-load';
import type { PaneMessage } from '@/lib/chat/transport/chat-transport';
import { useTransferPicture } from '../hooks/useTransferPicture';
import { PictureViewer } from '../PictureViewer';

/** The conversation's pictures, oldest first: what the viewer's previous and next move through. */
function picturesWith(peerCid: string): FileTransfer[] {
  return fileTransferService.getTransfersForPeer(peerCid)
    .filter((t: FileTransfer): boolean => looksLikePicture(t.fileName, t.fileType, t.fileSize) && (!t.isIncoming || t.state === 'complete'))
    .sort((a: FileTransfer, b: FileTransfer): number => a.createdAt - b.createdAt);
}

export function TransferPicture({ message, isOwn }: { message: PaneMessage; isOwn: boolean }): JSX.Element | null {
  const name: string = message.file_name ?? '';
  const eligible: boolean = looksLikePicture(name, message.file_type, message.file_size ?? 0);
  const load: PictureLoad | null = useTransferPicture(eligible && message.transfer_id ? fileTransferService.getTransfer(message.transfer_id) : undefined);
  const [gallery, setGallery] = useState<{ pictures: FileTransfer[]; at: number } | null>(null);
  if (!eligible || !message.transfer_id) return null;

  const shown: boolean = load !== null && 'url' in load;
  const src: string | null = load !== null && 'url' in load ? load.url : safeThumbnail(message.file_thumbnail);
  const size: { width: number; height: number } | undefined = load !== null && 'url' in load ? load.picture.size : undefined;
  const transferId: string = message.transfer_id;
  if (src === null) {
    return load === null ? <div className="mb-2 h-40 w-56 max-w-full rounded-md bg-foreground/10 motion-safe:animate-pulse" aria-hidden="true" /> : null;
  }

  const open = (): void => {
    // A direct chat's pictures page through its peer's; without a peer (absent CIDs) only this one shows.
    const peerCid: bigint | undefined = isOwn ? message.recipientCid : message.senderCid;
    const pictures: FileTransfer[] = peerCid === undefined ? [] : picturesWith(peerCid.toString());
    const at: number = pictures.findIndex((t: FileTransfer): boolean => t.id === transferId);
    const own: FileTransfer | undefined = fileTransferService.getTransfer(transferId);
    if (at >= 0) setGallery({ pictures, at });
    else if (own) setGallery({ pictures: [own], at: 0 });
  };

  return (
    <>
      <button type="button" onClick={open} aria-label={`View ${name} full size`} data-testid="transfer-picture"
        className="mb-2 block max-w-full overflow-hidden rounded-md bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <img src={src} alt={name} width={size?.width} height={size?.height} draggable={false} data-shown={shown ? 'picture' : 'thumbnail'}
          className={shown ? 'block h-auto max-h-64 w-auto max-w-full object-contain' : 'block h-40 w-56 max-w-full object-cover'} />
      </button>
      {gallery !== null && <PictureViewer pictures={gallery.pictures} startIndex={gallery.at} onClose={(): void => setGallery(null)} />}
    </>
  );
}
