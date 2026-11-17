/**
 * File Transfer I/O Router Factory
 *
 * Factory for creating IFileTransferIORouter implementations.
 * Uses the real protocol (native SendFile command) exclusively.
 */

import type { IFileTransferIORouter } from './io-router';
import type { IORouterType, IORouterConfig } from './io-router-types';
import { RealProtocolIORouter } from './real-protocol-io-router';

/**
 * Create an I/O router based on the specified type.
 *
 * @param type - Router type (only 'real-protocol' is supported)
 * @returns IFileTransferIORouter implementation
 *
 * @example
 * // Use real protocol (native SendFile/RespondFileTransfer)
 * const router = createIORouter('real-protocol');
 */
export function createIORouter(type: IORouterType): IFileTransferIORouter {
  switch (type) {
    case 'real-protocol':
      return new RealProtocolIORouter();

    default: {
      const exhaustiveCheck: never = type;
      throw new Error(`Unknown IORouterType: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Create an I/O router based on configuration.
 *
 * @param config - Router configuration
 * @returns IFileTransferIORouter implementation
 *
 * @example
 * const router = createIORouterFromConfig({
 *   type: 'real-protocol',
 * });
 */
export function createIORouterFromConfig(config: IORouterConfig): IFileTransferIORouter {
  return createIORouter(config.type);
}

/**
 * Get the default router type.
 *
 * Returns 'real-protocol' which uses the native SendFile command.
 * This requires file paths (from PickFile) rather than browser File objects.
 */
export function getDefaultRouterType(): IORouterType {
  return 'real-protocol';
}

/**
 * Check if the real protocol router is available.
 *
 * Real protocol requires:
 * - Native file system access (PickFile API)
 * - InternalServiceRequest support for SendFile/RespondFileTransfer
 *
 * @returns true if real protocol can be used
 */
export function isRealProtocolAvailable(): boolean {
  // Real protocol is always available in the internal service
  // The limitation is browser-side: we can only use file paths from PickFile
  return true;
}

// Re-export types and implementations for convenience
export { RealProtocolIORouter } from './real-protocol-io-router';
export type { IFileTransferIORouter } from './io-router';
export type { IORouterType, IORouterConfig } from './io-router-types';
