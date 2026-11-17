/**
 * Utils Module
 *
 * Centralized utilities for the Citadel Workspaces application.
 * Re-exports specialized utilities from utils/ subdirectory.
 */

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

// Tailwind CSS class merging utility (shadcn/ui)
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

// File size formatting. One implementation, in lib/format-bytes.
export { formatBytes as formatFileSize } from './format-bytes';

// Re-export specialized utilities
export * from './utils/index';
