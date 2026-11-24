/**
 * The apps built into the page that open files, as openers: derived from the registry's one
 * definition of each app (its `opens`), so the list cannot drift from it. Installed Citadel Apps
 * are openers from their signed manifests instead (installed-openers.ts).
 */
import { CITADEL_APPS, isFileOpeningAppId, type CitadelApp } from '../registry';
import type { FileOpener } from './openers';

export const BUILT_IN_OPENERS: readonly FileOpener[] = CITADEL_APPS.flatMap((app: CitadelApp): FileOpener[] => (
  isFileOpeningAppId(app.id) && app.opens.length > 0
    ? [{ kind: 'page', id: app.id, name: app.name, icon: app.icon, firstParty: true, opens: app.opens }]
    : []
));
