/** What kind of device the browser says it runs on, or null when it does not say. */
export function deviceKind(userAgent: string): 'iPhone or iPad' | 'Mac' | 'Android device' | 'Windows PC' | null {
  if (/iPhone|iPad/.test(userAgent)) return 'iPhone or iPad';
  if (/Macintosh/.test(userAgent)) return 'Mac';
  if (/Android/.test(userAgent)) return 'Android device';
  if (/Windows/.test(userAgent)) return 'Windows PC';
  return null;
}

/** A name for a new key that says where it lives, from the browser's own description of itself. */
export function defaultPasskeyLabel(userAgent: string): string {
  switch (deviceKind(userAgent)) {
    case 'iPhone or iPad': return 'Passkey on this iPhone or iPad';
    case 'Mac': return 'Passkey on this Mac';
    case 'Android device': return 'Passkey on this Android device';
    case 'Windows PC': return 'Windows Hello or security key';
    case null: return 'Passkey or security key';
  }
}

/** A name for this device among an account's sign-ins, as a recovery records it. */
export function defaultDeviceLabel(userAgent: string): string {
  const kind: string | null = deviceKind(userAgent);
  return kind === null ? 'This device' : `My ${kind}`;
}
