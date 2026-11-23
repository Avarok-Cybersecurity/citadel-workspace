/**
 * The Calendar's settings card (Settings -> Notifications) in each state the zone view can put it
 * in while the Calendar does not reach the member, drawn by the shipped placeholder
 * (AppZoneRequired, placement "setting") with the Calendar's own name and icon.
 */
import { AppZoneRequired } from '@/components/office/app-zone/AppZoneRequired';
import calendarManifest from '../../../../apps/first-party/calendar/manifest.json';

const CALENDAR = 'net.avarok.calendar';

const NAME = calendarManifest.name;
const VIEWS = [
  ['needs-answer', { kind: 'needs-answer', name: NAME }],
  ['install', { kind: 'install', name: NAME, elsewhere: false }],
  ['ask-admin', { kind: 'ask-admin', name: NAME, elsewhere: true }],
  ['failed', { kind: 'failed' }],
  ['not-available', { kind: 'not-available' }],
];
const ACTIONS = { onInstall: () => {}, onEnable: () => {}, onCopyLink: async () => {}, onOpenApps: () => {}, onRetry: () => {} };

function SettingsPlaceholders() {
  return (
    <div className="flex flex-col gap-[12px] p-[16px]">
      {VIEWS.map(([key, view]) => (
        <section key={key} data-testid={`settings-card-${key}`} aria-label={`Calendar, ${key}`} className="space-y-3 rounded-lg border border-border bg-card/40 p-3 sm:p-4">
          <h4 className="text-sm font-semibold text-foreground">Calendar</h4>
          <AppZoneRequired placement="setting" appId={CALENDAR} floor={null} height={0} view={view} icon={calendarManifest.icon} {...ACTIONS} />
        </section>
      ))}
    </div>
  );
}

export const APP_SETTINGS_SCENARIOS = {
  'app-settings-placeholders': () => <SettingsPlaceholders />,
};
