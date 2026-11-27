/**
 * Photos a browser may not draw itself, in the full-size viewer: a HEIC, an LZW TIFF, a DNG whose
 * preview says its orientation twice (in the DNG and in its JPEG's Exif) and a damaged HEIC, each this tab's own send (as scenarios-chat-files.jsx sends PNGs). The viewer's load goes
 * through the real photo decoder: its worker, glue and binary, so Chromium decodes in wasm and
 * WebKit (which draws HEIC and TIFF itself) takes the native path. Fixtures: crates/photo-decode.
 */
import { useEffect, useState } from 'react';
import { PictureViewer } from '@/components/p2p/PictureViewer';
import { rememberSentPicture } from '@/lib/received-files/sent-pictures';
import { browserSentPictureStore } from '@/lib/received-files/sent-picture-store';
import heicUrl from '../../../../crates/photo-decode/tests/fixtures/checker-64.heic?url';
import tiffUrl from '../../../../crates/photo-decode/tests/fixtures/quadrants-48-lzw.tif?url';
import turnedUrl from '../../../../crates/photo-decode/tests/fixtures/turned-6.dng?url';

const sent = (id, fileName, at) => ({
  id, fileName, fileSize: 1, fileType: '', state: 'complete', progress: 100,
  sender_cid: '7', recipient_cid: '42', createdAt: at, updatedAt: at, isIncoming: false,
});

const PHOTOS = [
  { transfer: sent('checker', 'IMG_0001.HEIC', 1), url: heicUrl, cut: null },
  { transfer: sent('scan', 'scan.tif', 2), url: tiffUrl, cut: null },
  { transfer: sent('turned', 'turned.dng', 3), url: turnedUrl, cut: null },
  // The container's first 300 bytes: still a HEIC by its brand, but its picture is gone.
  { transfer: sent('damaged', 'damaged.heic', 4), url: heicUrl, cut: 300 },
];

async function keep({ transfer, url, cut }) {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const file = new File([cut === null ? bytes : bytes.slice(0, cut)], transfer.fileName);
  const refused = await rememberSentPicture(browserSentPictureStore, { own: transfer.sender_cid, peer: transfer.recipient_cid, transferId: transfer.id }, file, transfer.createdAt);
  if (refused !== null) throw new Error(`${transfer.fileName}: ${refused}`);
}

function PhotoViewer() {
  const [pictures, setPictures] = useState(null);
  useEffect(() => {
    void Promise.all(PHOTOS.map(keep)).then(() => setPictures(PHOTOS.map((p) => p.transfer)));
  }, []);
  return pictures === null ? null : <PictureViewer pictures={pictures} startIndex={0} onClose={() => {}} />;
}

export const PHOTO_SCENARIOS = { 'photo-viewer': PhotoViewer };
