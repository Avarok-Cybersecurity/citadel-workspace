/**
 * Citadel Workspace Integration Test Library
 *
 * This file re-exports everything from the modular lib folder.
 * For new code, prefer importing directly from './lib/index.js'
 *
 * The library is now organized into smaller modules:
 * - lib/types.ts      - Type definitions
 * - lib/config.ts     - Configuration
 * - lib/utils.ts      - Utility functions
 * - lib/ux-tracker.ts - UX issue tracking
 * - lib/observation.ts - Debug logging
 * - lib/screenshots.ts - Screenshot utilities
 * - lib/modals.ts     - Modal/dialog utilities
 * - lib/browser.ts    - Browser setup
 * - lib/report.ts     - Test report generation
 * - lib/account.ts    - Account management
 * - lib/p2p.ts        - P2P operations
 * - lib/messaging.ts  - Messaging operations
 * - lib/live-docs.ts  - Live document operations
 */

export * from './lib/index.js';
