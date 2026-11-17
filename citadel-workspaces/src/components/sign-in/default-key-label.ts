/** A name for a new key that says where it lives, from the browser's own description of itself. */
export function defaultPasskeyLabel(userAgent: string): string {
  if (/iPhone|iPad/.test(userAgent)) return 'Passkey on this iPhone or iPad';
  if (/Macintosh/.test(userAgent)) return 'Passkey on this Mac';
  if (/Android/.test(userAgent)) return 'Passkey on this Android device';
  if (/Windows/.test(userAgent)) return 'Windows Hello or security key';
  return 'Passkey or security key';
}
