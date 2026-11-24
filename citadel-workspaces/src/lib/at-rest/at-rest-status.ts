/**
 * What the document's lock says about "Encrypt on this device", from the setting's store and
 * nothing else. Four answers, because two would lie: while the setting is unread the lock is
 * neither locked nor open, and while a change is converting the records it is not yet either.
 */
import type { AtRestSetting } from './at-rest-setting';
import { AT_REST_STATUS_CHANGING, AT_REST_STATUS_OFF, AT_REST_STATUS_ON, AT_REST_STATUS_UNKNOWN } from './at-rest-copy';

export type AtRestStatus = 'on' | 'off' | 'changing' | 'unknown';

export function atRestStatusOf(setting: AtRestSetting): AtRestStatus {
  if (setting.changing) return 'changing';
  if (setting.on === null) return 'unknown';
  return setting.on ? 'on' : 'off';
}

export const AT_REST_STATUS_TEXT: Readonly<Record<AtRestStatus, string>> = {
  on: AT_REST_STATUS_ON,
  off: AT_REST_STATUS_OFF,
  changing: AT_REST_STATUS_CHANGING,
  unknown: AT_REST_STATUS_UNKNOWN,
};
