/**
 * The Citadel Docs Web Worker: cdoc-wasm, the open document and the OffscreenCanvas painter,
 * off the main thread. This file is the only wiring of real adapters to the host.
 */
import { CDOC_FONT_BASE_URL, CDOC_PATTERN_BASE_URL } from '../asset-urls';
import { CdocEngine } from '../engine/cdoc-engine';
import { EngineAssets } from '../engine/engine-assets';
import { loadCdocEditorWasm, loadCdocPdfWasm } from '../engine/load-wasm';
import { PdfWriter } from '../engine/pdf-writer';
import { fetchFontSource } from '../fonts/fetch-font-source';
import { fetchPatternSource } from '../fonts/fetch-pattern-source';
import { FONT_MANIFEST } from '../generated/font-manifest';
import { PATTERN_MANIFEST } from '../generated/pattern-manifest';
import { canvasTarget, domCanvasPort } from '../paint/dom-canvas-port';
import { ASSET_FETCH_TIMEOUT_MS, RASTERIZER_OPTIONS } from '../paint/paint-config';
import { CdocHost, type HostReply } from './cdoc-host';
import { isCdocRequest, type CdocResponse } from './protocol';
import type { EngineLoadMessage } from './engine-load';
import type { ByteProgress } from '@/lib/app-loading/load-stage';

interface WorkerScope {
  postMessage(message: CdocResponse | EngineLoadMessage, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

const scope: WorkerScope = self as unknown as WorkerScope;

const host: CdocHost = new CdocHost({
  engine: async (): Promise<CdocEngine> => {
    const assets: EngineAssets = new EngineAssets(
      FONT_MANIFEST, fetchFontSource(CDOC_FONT_BASE_URL, ASSET_FETCH_TIMEOUT_MS),
      PATTERN_MANIFEST, fetchPatternSource(CDOC_PATTERN_BASE_URL, ASSET_FETCH_TIMEOUT_MS),
    );
    const downloading = (bytes: ByteProgress): void => scope.postMessage({ engineLoad: { kind: 'downloading', bytes } }, []);
    const engine: CdocEngine = new CdocEngine(await loadCdocEditorWasm(downloading), assets, new PdfWriter(loadCdocPdfWasm, assets));
    scope.postMessage({ engineLoad: { kind: 'ready' } }, []);
    return engine;
  },
  port: domCanvasPort(),
  rasterizer: RASTERIZER_OPTIONS,
  target: canvasTarget,
});

scope.addEventListener('message', (event: MessageEvent<unknown>): void => {
  const request: unknown = event.data;
  if (!isCdocRequest(request)) {
    console.error('cdoc worker: ignored a message that is not a protocol request');
    return;
  }
  void host.handle(request).then((reply: HostReply): void => scope.postMessage(reply.response, reply.transfer));
});
