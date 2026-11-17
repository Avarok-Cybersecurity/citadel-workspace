/**
 * A fetched Response that reports its body's bytes as they stream, for the engine's download bar.
 * The copy keeps the original's status and headers (Content-Type: application/wasm included), so
 * `WebAssembly.instantiateStreaming` still compiles it while it arrives.
 *
 * The total is the Content-Length only when the body is not content-encoded: a compressed
 * response's length counts the compressed bytes while the stream yields the decoded ones, so a
 * total there would overrun. Such a download is reported without one (bytes so far only).
 */
import type { ByteProgress } from '@/lib/app-loading/load-stage';

export function declaredTotal(headers: Headers): number | null {
  const encoding: string = (headers.get('Content-Encoding') ?? 'identity').trim().toLowerCase();
  if (encoding !== 'identity' && encoding !== '') return null;
  const length: number = Number(headers.get('Content-Length') ?? '');
  return Number.isSafeInteger(length) && length > 0 ? length : null;
}

export function withByteProgress(response: Response, report: (progress: ByteProgress) => void): Response {
  if (!response.ok || response.body === null) return response;
  const total: number | null = declaredTotal(response.headers);
  let loaded: number = 0;
  report({ loaded, total });
  const counted: ReadableStream<Uint8Array> = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>): void {
      loaded += chunk.byteLength;
      report({ loaded, total });
      controller.enqueue(chunk);
    },
  }));
  return new Response(counted, { status: response.status, statusText: response.statusText, headers: response.headers });
}
