/**
 * Server Auto-Connect Service - Barrel Export
 *
 * Re-exports ALL public exports from the module for backward compatibility.
 * Consumers import from '@/lib/server-auto-connect-service' (resolves to this file).
 */

// Main service class & singleton
export { ServerAutoConnectService } from './service';

import { ServerAutoConnectService } from './service';
export const serverAutoConnectService: ServerAutoConnectService = ServerAutoConnectService.getInstance();
