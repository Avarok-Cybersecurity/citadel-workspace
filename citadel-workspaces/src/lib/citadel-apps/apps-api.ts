/**
 * The apps requests bound to this tab's workspace session: the one I/O boundary the marketplace
 * and the zone placeholder take, so their tests substitute a contract fake of the kernel.
 */
import WorkspaceService from '@/lib/workspace-service';
import { protocolAppsTransport, serialAppsTransport, type AppsTransport } from '@/lib/workspace-service/apps-operations';

/** Serial: every apps request this tab makes waits for the one before it (serialAppsTransport). */
export const sessionAppsTransport: AppsTransport = serialAppsTransport(protocolAppsTransport(WorkspaceService));
