/**
 * The chat's file surfaces: a picture in its bubble, the full-size viewer, and the first-offer
 * "always accept?" question. Real components; the pictures are this tab's own sends (held in
 * memory as the app holds them) and a sender's inline thumbnail, so no agent is needed.
 */
import { useEffect, useState } from 'react';
import { FileTransferBubble } from '@/components/p2p/bubbles/FileTransferBubble';
import { PictureViewer } from '@/components/p2p/PictureViewer';
import { AlwaysAcceptDialog } from '@/components/p2p/AlwaysAcceptDialog';
import { rememberSentPicture } from '@/lib/received-files/sent-pictures';
import { browserSentPictureStore } from '@/lib/received-files/sent-picture-store';

// 2x1 PNG, wider than tall, so fit-to-screen has an aspect ratio to keep.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGOQi1rw/8Mqm/8AE18E7d5tOQ0AAAAASUVORK5CYII=';
const pngFile = (name) => new File([Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0))], name, { type: 'image/png' });

const sent = (id, at) => ({
  id, fileName: `${id}.png`, fileSize: 74, fileType: 'image/png', state: 'complete', progress: 100,
  senderCid: '7', recipientCid: '42', createdAt: at, updatedAt: at, isIncoming: false,
});

function Viewer() {
  const [pictures, setPictures] = useState(null);
  useEffect(() => {
    const list = [sent('harbour-at-dusk', 1), sent('lighthouse', 2), sent('pier', 3)];
    const keep = (t) => rememberSentPicture(browserSentPictureStore, { own: t.senderCid, peer: t.recipientCid, transferId: t.id }, pngFile(t.fileName), t.createdAt);
    void Promise.all(list.map(keep)).then(() => setPictures(list));
  }, []);
  return pictures === null ? null : <PictureViewer pictures={pictures} startIndex={1} onClose={() => {}} />;
}

function PictureBubble() {
  const message = {
    id: 'm1', content: 'File transfer: sunset.png', senderCid: 42n, recipientCid: 7n, timestamp: 1, status: 'delivered',
    message_type: 'file_transfer', transfer_id: 'not-on-this-device', file_name: 'sunset.png', file_size: 74, file_type: 'image/png',
    file_thumbnail: `data:image/png;base64,${PNG_B64}`, transfer_mode: 'p2p', transfer_state: 'pending',
  };
  return <div style={{ padding: 16 }}><FileTransferBubble message={message} isOwn={false} /></div>;
}

// A peer's name is often its username, one unbreakable token: CI's peers are named like this one,
// and "Always accept from <it>" outgrew the dialog and pushed "Ask me each time" off its left edge.
function AlwaysAccept() {
  const offer = sent('quarterly-report', 1);
  return <AlwaysAcceptDialog peerName="file_alice_1794760367429" prompt={{ offer: { ...offer, fileName: 'quarterly-report.pdf', isIncoming: true, state: 'pending' }, answer: async () => {}, dismiss: () => {} }} />;
}

export const CHAT_FILE_SCENARIOS = { 'picture-viewer': Viewer, 'picture-bubble': PictureBubble, 'always-accept': AlwaysAccept };
