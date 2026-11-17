/**
 * Files for the open/export tests: the vendored fixtures (fixtures/files/LICENSES.md), and a
 * fresh in-process client per test, so each starts with nothing open. The client is the
 * production host, engine and wasm (wasm-rig); nothing here stands in for any of them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { CdocClient } from '../worker/cdoc-client';
import { InProcessCdocClient } from '../worker/clients';
import { recordingPort, recordingTarget } from '../paint/__tests__/recording-canvas';
import { realHost } from './wasm-rig';

export function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(process.cwd(), 'src/lib/cdoc/__tests__/fixtures/files', name)));
}

export function freshClient(): CdocClient {
  return new InProcessCdocClient(realHost(recordingPort().port, recordingTarget));
}

const utf8: TextDecoder = new TextDecoder();
export const text = (bytes: Uint8Array): string => utf8.decode(bytes);
export const bytesOf = (s: string): Uint8Array => new TextEncoder().encode(s);

/** One entry of a zip package (stored or deflated), read from its local header, as text. */
export function zipEntryText(zip: Uint8Array, name: string): string {
  const view: DataView = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let at: number = 0; at + 30 <= zip.length && view.getUint32(at, true) === 0x04034b50;) {
    const method: number = view.getUint16(at + 8, true);
    const size: number = view.getUint32(at + 18, true);
    const nameLength: number = view.getUint16(at + 26, true);
    const extra: number = view.getUint16(at + 28, true);
    const start: number = at + 30 + nameLength + extra;
    if (text(zip.subarray(at + 30, at + 30 + nameLength)) === name) {
      const data: Uint8Array = zip.subarray(start, start + size);
      return text(method === 0 ? data : inflateRawSync(data));
    }
    at = start + size;
  }
  throw new Error(`${name} is not in the package`);
}
