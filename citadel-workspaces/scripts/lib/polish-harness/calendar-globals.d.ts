/** Handles the Calendar scenarios put on the page so their checks (checks-calendar-*.mjs) read the store through the shipped codecs. */
interface Window {
  __calendarKeys?: () => string[];
  __calendarEvent?: (key: string) => unknown;
  __calendarRead?: (codec: string, key: string) => unknown;
  __calendarTeam?: (codec: string, key: string) => unknown;
}
