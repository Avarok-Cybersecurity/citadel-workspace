/**
 * The protocol end to end with the production wasm: InProcessCdocClient runs the real host and
 * engine; WorkerCdocClient runs over a real MessageChannel (node's), so structured clone and
 * buffer transfer are the platform's, not simulated.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { openDisplayList } from '../../display-list/decoder';
import { decodePage } from '../../display-list/page-ops';
import type { DisplayList, Op } from '../../display-list/types';
import { parseFaceMetrics, parseGlyphPath, type GlyphOutline } from '../../glyph/glyph-record';
import type { GlyphPathBatch } from '../../engine/cdoc-engine';
import type { PaintOutcome } from '../../paint/page-rasterizer';
import { pmWithText, realHost } from '../../__tests__/wasm-rig';
import type { OpenedDocument } from '../../engine/cdoc-engine';
import { recordingPort, recordingTarget, type Call, type RecordingTarget } from '../../paint/__tests__/recording-canvas';
import type { CdocClient } from '../cdoc-client';
import type { CdocHost } from '../cdoc-host';
import { InProcessCdocClient, WorkerCdocClient, type WorkerLike } from '../clients';
import { isCdocRequest, transferablesOf } from '../protocol';

const TEXT: string = 'Citadel Docs paints this line from a glyph atlas.';
const targets: RecordingTarget[] = [];
const host = (): CdocHost => realHost(recordingPort().port, (): RecordingTarget => {
  const t: RecordingTarget = recordingTarget();
  targets.push(t);
  return t;
});

function glyphCount(list: DisplayList): number {
  return decodePage(list, 0).ops.reduce((n: number, o: Op) => n + (o.kind === 'glyphRun' ? o.glyphIds.length : 0), 0);
}

describe('InProcessCdocClient over the real wasm', () => {
  const client: CdocClient = new InProcessCdocClient(host());

  it('opens a one-line document as one A4 page', async () => {
    const opened: OpenedDocument = await client.request({ kind: 'open', source: { kind: 'pm', pmJson: pmWithText(TEXT) } });
    expect(opened.pageCount).toBe(1);
    expect(Array.from(opened.pageSizes)).toEqual([59530, 84190]);
  });

  it('paints text into a display list that decodes, with outlines and metrics for its face', async () => {
    await client.request({ kind: 'open', source: { kind: 'pm', pmJson: pmWithText(TEXT) } });
    const { displayList } = await client.request({ kind: 'paint', pages: [0] });
    const list: DisplayList = openDisplayList(displayList);
    expect(glyphCount(list)).toBe(TEXT.replace(/ /g, '').length + (TEXT.match(/ /g) ?? []).length);
    const face: DisplayList['faces'][number] = list.faces[0];
    expect(face.family).toBe('Carlito');
    const ids: Uint16Array = Uint16Array.from(face.glyphs.map((g) => g.glyphId));
    const batch: GlyphPathBatch = await client.request({ kind: 'glyphPaths', face, glyphIds: ids });
    expect(batch.offsets).toHaveLength(ids.length + 1);
    const outlines: GlyphOutline[] = Array.from(ids, (_: number, i: number) => parseGlyphPath(batch.records.subarray(batch.offsets[i], batch.offsets[i + 1])));
    expect(outlines.filter((o) => o.verbs.length > 0).length).toBe(ids.length - 1); // all but the space
    const { metrics } = await client.request({ kind: 'faceMetrics', face });
    expect(parseFaceMetrics(metrics).unitsPerEm).toBe(2048);
  });

  it('paints an attached canvas in the host with outlines straight from the wasm', async () => {
    await client.request({ kind: 'open', source: { kind: 'pm', pmJson: pmWithText(TEXT) } });
    await client.request({ kind: 'attachCanvas', slot: 3, canvas: {} as OffscreenCanvas });
    const outcome: PaintOutcome = await client.request({ kind: 'paintCanvas', slot: 3, pageNumber: 0, zoom: 1.5, dpr: 2 });
    const drawn: Call[] = targets[targets.length - 1].calls.filter((c: Call) => c.name === 'drawImage');
    expect(drawn.length).toBe(outcome.atlas.hits + outcome.atlas.misses);
    expect(drawn.length).toBeGreaterThan(30);
  });

  it('refuses a page the document does not have, naming the request', async () => {
    await expect(client.request({ kind: 'paint', pages: [7] })).rejects.toThrow(/cdoc paint: display list: page 7 is not in the document/);
  });
});

describe('WorkerCdocClient over a real MessageChannel', () => {
  const ports: MessagePort[] = [];
  afterEach(() => ports.splice(0).forEach((p: MessagePort) => p.close()));

  function wired(): CdocClient {
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    const h: CdocHost = host();
    port2.on('message', (data: unknown) => {
      if (isCdocRequest(data)) void h.handle(data).then((reply) => port2.postMessage(reply.response, reply.transfer as never[]));
    });
    port1.start();
    return new WorkerCdocClient(port1 as unknown as WorkerLike, (): void => port1.close());
  }

  it('transfers request buffers: the sender\'s copy is detached once sent', async () => {
    const client: CdocClient = wired();
    await client.request({ kind: 'open', source: { kind: 'pm', pmJson: pmWithText(TEXT) } });
    const glyphIds: Uint16Array = Uint16Array.from([1, 2, 3]);
    const reply: Promise<unknown> = client.request({ kind: 'glyphPaths', face: { family: 'Carlito', bold: false, italic: false }, glyphIds });
    expect(glyphIds.byteLength).toBe(0);
    await expect(reply).resolves.toBeTruthy();
  });

  it('lists every buffer of a payload for transfer, inside arrays too', () => {
    const updates: readonly Uint8Array[] = [Uint8Array.from([1]), Uint8Array.from([2])];
    expect(transferablesOf({ updates })).toEqual(updates.map((u: Uint8Array) => u.buffer));
  });

  it('receives the display list as bytes that decode', async () => {
    const client: CdocClient = wired();
    await client.request({ kind: 'open', source: { kind: 'pm', pmJson: pmWithText(TEXT) } });
    const { displayList } = await client.request({ kind: 'paint', pages: [0] });
    expect(openDisplayList(displayList).pages).toHaveLength(1);
  });

  it('rejects every pending request on dispose', async () => {
    const client: CdocClient = wired();
    const pending: Promise<unknown> = client.request({ kind: 'open', source: { kind: 'pm', pmJson: pmWithText(TEXT) } });
    client.dispose();
    await expect(pending).rejects.toThrow(/disposed/);
  });
});
