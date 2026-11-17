/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Window augmentation for dev-only debug exports
// These are set at module scope in main.tsx, service files for integration testing
import type { P2PRegistrationService } from './lib/p2p-registration-service';
import type { P2PAutoConnectService } from './lib/p2p-auto-connect-service';
import type { websocketService } from './lib/websocket-service';
import type { ConnectionManager } from './lib/connection/service';
import type { FileTransferService } from './lib/file-transfer/service';
import type { WorkspaceService } from './lib/workspace-service';
import type { NotificationService } from './lib/notification-service';

declare global {
  /** Unix seconds at which this build was made; see multi-instance/build-identity.ts. */
  const __BUILD_SEQ__: number;

  interface Window {
    __p2pRegistrationService?: P2PRegistrationService;
    __p2pAutoConnectService?: P2PAutoConnectService;
    __websocketService?: typeof websocketService;
    __serverAutoConnectService?: { getPendingReconnectCount(): number };
    __connectionManager?: ConnectionManager;
    __fileTransferService?: FileTransferService;
    __workspaceService?: WorkspaceService;
    notificationService?: NotificationService;
  }
}
