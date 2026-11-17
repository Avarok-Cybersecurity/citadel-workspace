/**
 * The name and type a received file is downloaded with are decided from its bytes and a
 * sanitised form of the sender's name: never a path, an invisible character, or a type the
 * page would render. Pure; no I/O.
 */
import { describe, it, expect } from 'vitest';
import { safeDownloadName } from '../download-name';
import { blobTypeFor } from '../blob-type';
import { sniffRaster } from '../raster-sniff';

const bytes = (...b: number[]): Uint8Array => new Uint8Array(b);
const ascii = (s: string): number[] => Array.from(s, (c: string): number => c.charCodeAt(0));

describe('the download name', () => {
  it('keeps an ordinary name and its extension', () => {
    expect(safeDownloadName('holiday photo.png')).toBe('holiday photo.png');
    expect(safeDownloadName('report.final.pdf')).toBe('report.final.pdf');
  });
  it('drops any path, either separator', () => {
    expect(safeDownloadName('../../.ssh/authorized_keys')).toBe('authorized_keys');
    expect(safeDownloadName('C:\\Users\\a\\x.txt')).toBe('x.txt');
  });
  it('strips control and bidirectional characters that disguise the extension', () => {
    expect(safeDownloadName('photo\u202Egpj.exe')).toBe('photogpj.exe');
    expect(safeDownloadName('a\u0000b\u0007.txt')).toBe('ab.txt');
  });
  it('defuses reserved names, forbidden characters and empty results', () => {
    expect(safeDownloadName('CON.txt')).toBe('_CON.txt');
    expect(safeDownloadName('a<b>:c?.txt')).toBe('a_b__c_.txt');
    expect(safeDownloadName('...')).toBe('download');
    expect(safeDownloadName('/')).toBe('download');
  });
  it('caps a long name but keeps its extension', () => {
    const name: string = safeDownloadName(`${'a'.repeat(400)}.jpeg`);
    expect(name.length).toBe(200);
    expect(name.endsWith('.jpeg')).toBe(true);
  });
});

describe('the blob type', () => {
  it('is what the bytes are for a raster image, whatever the name says', () => {
    expect(blobTypeFor(bytes(0xff, 0xd8, 0xff, 0xe0), 'x.png')).toBe('image/jpeg');
    expect(blobTypeFor(bytes(...ascii('GIF89a')), 'x')).toBe('image/gif');
    expect(blobTypeFor(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')), 'x')).toBe('image/webp');
    expect(blobTypeFor(bytes(0, 0, 0, 0x1c, ...ascii('ftypavif')), 'x')).toBe('image/avif');
  });
  it('is never a type the page renders as a document or runs', () => {
    expect(blobTypeFor(bytes(...ascii('<svg onload=alert(1)>')), 'x.svg')).toBe('application/octet-stream');
    expect(blobTypeFor(bytes(...ascii('<html>')), 'x.html')).toBe('application/octet-stream');
    expect(blobTypeFor(bytes(...ascii('alert(1)')), 'x.js')).toBe('application/octet-stream');
  });
  it('is the declared type for an ordinary document, and opaque for a fake image', () => {
    expect(blobTypeFor(bytes(...ascii('%PDF-1.7')), 'a.pdf')).toBe('application/pdf');
    expect(blobTypeFor(bytes(1, 2, 3), 'not-really.png')).toBe('application/octet-stream');
  });
  it('sniffs nothing from too few bytes', () => {
    expect(sniffRaster(bytes(0x89, 0x50))).toBeNull();
  });
});
