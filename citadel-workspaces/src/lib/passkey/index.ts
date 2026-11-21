/** Whether this page can run a passkey ceremony at all. */
import { webAuthnAvailable } from './rp-id';

export function passkeysAvailableHere(): boolean {
  return typeof window !== 'undefined' && webAuthnAvailable(window);
}
