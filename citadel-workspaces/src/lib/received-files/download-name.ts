/**
 * The name a received file is saved under, from the name its sender declared.
 *
 * The name is the peer's: it may carry a path ("../../.ssh/config"), control or bidirectional
 * characters that make a name read as "photo.exe.jpg" when it is "photo.jpg.exe", characters Windows refuses, or a
 * reserved device name. The browser's own download path is the last line, not the only one.
 */
const FALLBACK_NAME: string = 'download';
const MAX_NAME_LENGTH: number = 200;
// C0 and C1 controls, and the zero-width and bidirectional formatting characters, by code point.
const INVISIBLE_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff, 0xfeff],
];

function visible(ch: string): boolean {
  const code: number = ch.codePointAt(0) ?? 0;
  return !INVISIBLE_RANGES.some(([lo, hi]: readonly [number, number]): boolean => code >= lo && code <= hi);
}
const FORBIDDEN: RegExp = /[<>:"|?*]/g;
const RESERVED: RegExp = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

function capped(name: string): string {
  if (name.length <= MAX_NAME_LENGTH) return name;
  const dot: number = name.lastIndexOf('.');
  const ext: string = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
  return name.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
}

export function safeDownloadName(declared: string): string {
  const base: string = declared.split(/[\\/]/).pop() ?? '';
  const cleaned: string = Array.from(base).filter(visible).join('').replace(FORBIDDEN, '_').replace(/[. ]+$/, '').replace(/^[. ]+/, '');
  if (cleaned === '') return FALLBACK_NAME;
  const stem: string = cleaned.split('.')[0];
  return capped(RESERVED.test(stem) ? `_${cleaned}` : cleaned);
}
