/**
 * The zones this browser knows (`Intl.supportedValuesOf('timeZone')`), for every place the Calendar
 * offers a zone to choose: the display zone, a schedule's zone, a type's locked zone, and the
 * booking page's switcher. The device's own zone is always among them, even where the list names
 * it by another (linked) name.
 */
export function knownZones(deviceZone: string): string[] {
  const listed: string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return listed.includes(deviceZone) ? listed : [deviceZone, ...listed];
}

/** Whether `Intl` can format times in `zone`: the check an editor holds a typed or stored zone to. */
export function isKnownZone(zone: string): boolean {
  if (zone === '') return false;
  try {
    new Intl.DateTimeFormat([], { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
