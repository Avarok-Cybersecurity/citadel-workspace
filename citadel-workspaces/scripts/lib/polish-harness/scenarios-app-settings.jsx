/**
 * The Calendar's placeholder in each state the zone view can put it in while the Calendar does not
 * run for the member, drawn by the shipped placeholder (AppZoneRequired) with the Calendar's own
 * name, icon and granted questions (consent-model.ts): in its settings card (Settings ->
 * Notifications, placement "setting") and in its tab (placement "tab", in AppTabPane's frame).
 */
import { AppZoneRequired } from '@/components/office/app-zone/AppZoneRequired';
import { memberAsks } from '@/lib/citadel-apps/consent-model';
import calendarManifest from '../../../../apps/first-party/calendar/manifest.json';

const CALENDAR = 'net.avarok.calendar';
const NAME = calendarManifest.name;
const GRANTED = calendarManifest.capabilities.map((c) => c.cap);
const INSTALL = { id: 'cal', app_id: CALENDAR, version: calendarManifest.version, scope: 'Workspace', granted: GRANTED };
const VIEWS = [
  ['needs-answer', { kind: 'needs-answer', name: NAME, install: INSTALL, asks: memberAsks(GRANTED, null) }],
  ['install', { kind: 'install', name: NAME, elsewhere: false }],
  ['ask-admin', { kind: 'ask-admin', name: NAME, elsewhere: true }],
  ['failed', { kind: 'failed' }],
  ['not-available', { kind: 'not-available' }],
  ['ready-unmounted', { kind: 'ready-unmounted', name: NAME }],
];
const ACTIONS = { onInstall: () => {}, onEnable: () => {}, onCopyLink: async () => {}, onOpenApps: () => {}, onRetry: () => {}, onAnswer: async () => {} };

const required = (placement, view, height) => <AppZoneRequired placement={placement} appId={CALENDAR} floor={null} height={height} view={view} icon={calendarManifest.icon} {...ACTIONS} />;

function SettingsPlaceholders() {
  return (
    <div className="flex flex-col gap-[12px] p-[16px]">
      {VIEWS.map(([key, view]) => (
        <section key={key} data-testid={`placeholder-card-${key}`} aria-label={`Calendar, ${key}`} className="space-y-3 rounded-lg border border-border bg-card/40 p-3 sm:p-4">
          <h4 className="text-sm font-semibold text-foreground">Calendar</h4>
          {required('setting', view, 0)}
        </section>
      ))}
    </div>
  );
}

/** Each state in the frame AppTabPane draws it in, one after another. */
function TabPlaceholders() {
  return (
    <div className="flex flex-col">
      {VIEWS.map(([key, view]) => (
        <section key={key} data-testid={`placeholder-card-${key}`} aria-label={`Calendar tab, ${key}`} className="mx-auto w-full max-w-3xl px-[16px] py-[8px]">
          {required('tab', view, 240)}
        </section>
      ))}
    </div>
  );
}

export const APP_SETTINGS_SCENARIOS = {
  'app-settings-placeholders': () => <SettingsPlaceholders />,
  'app-tab-placeholders': () => <TabPlaceholders />,
};
