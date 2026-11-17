/**
 * Debug Observation Logging
 */

import * as fs from 'fs';
import * as path from 'path';
import { config } from './config.js';
import type { DebugObservation } from './types.js';

let observationCounter = 0;

/**
 * Log a debug observation to the JSONL file
 */
export function logObservation(
  phase: string,
  observation: string,
  details: Record<string, unknown>,
  status: DebugObservation['status'] = 'investigating'
): void {
  observationCounter++;
  const entry: DebugObservation = {
    timestamp: new Date().toISOString(),
    iteration: observationCounter,
    phase,
    observation,
    details,
    status,
  };

  // Ensure logs directory exists
  if (!fs.existsSync(config.LOGS_DIR)) {
    fs.mkdirSync(config.LOGS_DIR, { recursive: true });
  }

  const logPath = path.join(config.LOGS_DIR, 'debug-observations.jsonl');
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  console.log(`  [DEBUG LOG] ${phase}: ${observation}`);
}
