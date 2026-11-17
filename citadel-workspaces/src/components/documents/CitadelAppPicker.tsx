/**
 * The one way a person chooses the Citadel App a new document opens in, wherever a document is
 * made: the workspace tree's New document, a chat's document, and any place added later (the
 * creation-site test fails for a site that does not render this). Every app in the registry is
 * listed, in registry order; one that cannot yet be made at this site says so and cannot be
 * chosen. Nothing is preselected: the caller keeps its Create disabled until `value` is set.
 */
import { CITADEL_APPS, creatableIn, isCitadelAppId, type CitadelApp, type CitadelAppId, type DocumentCreationSite } from '@/lib/citadel-apps/registry';
import { ChoiceList, type Choice } from './ChoiceList';

/** What the picker is called, to the eye and to a screen reader. */
export const APP_PICKER_LEGEND: string = 'App';

const COMING_SOON: string = 'Coming soon';

function appChoices(site: DocumentCreationSite): Choice[] {
  return CITADEL_APPS.map((app: CitadelApp): Choice => ({
    value: app.id,
    label: app.name,
    detail: app.description,
    icon: app.icon,
    unavailable: creatableIn(app, site) ? null : COMING_SOON,
  }));
}

interface CitadelAppPickerProps {
  /** Where the document is being made: an app not yet made there is listed as coming soon. */
  site: DocumentCreationSite;
  value: CitadelAppId | null;
  onChange: (app: CitadelAppId) => void;
  /** Prefixes each row's test id: `${testId}-${app id}`. */
  testId: string;
}

export function CitadelAppPicker({ site, value, onChange, testId }: CitadelAppPickerProps): JSX.Element {
  return (
    <ChoiceList
      legend={APP_PICKER_LEGEND}
      choices={appChoices(site)}
      value={value}
      onChange={(next: string): void => { if (isCitadelAppId(next)) onChange(next); }}
      testId={testId}
    />
  );
}
