/**
 * Security utilities - Single source of truth for security settings types and helpers
 * Implements DRY principle for security settings across the application
 */

import type { SecuritySettingsValues } from '@/components/SecuritySettings';
import { isVariant } from 'citadel-workspace-client-ts';

/**
 * HeaderObfuscatorSettings - matches Rust enum
 * In Rust: pub enum HeaderObfuscatorSettings { Disabled, Enabled, EnabledWithKey(u128) }
 * Serializes to: "Disabled" | "Enabled" | { EnabledWithKey: number }
 */
export type HeaderObfuscatorSettings = "Disabled" | "Enabled" | { EnabledWithKey: number };

/**
 * SessionSecuritySettings - matches the Rust struct for protocol-level security configuration
 * Uses snake_case to match Rust serialization
 */
export interface SessionSecuritySettings {
  security_level: string;
  secrecy_mode: string;
  crypto_params: {
    encryption_algorithm: string;
    kem_algorithm: string;
    sig_algorithm: string;
  };
  header_obfuscator_settings: HeaderObfuscatorSettings;
}

/**
 * Returns default security settings for sessions
 * Used when no specific settings are provided (e.g., login flow)
 */
export function getDefaultSecuritySettings(): SessionSecuritySettings {
  return {
    security_level: "Standard",
    secrecy_mode: "BestEffort",
    crypto_params: {
      encryption_algorithm: "AES_GCM_256",
      kem_algorithm: "MlKem",
      sig_algorithm: "None",
    },
    header_obfuscator_settings: "Disabled"
  };
}

/**
 * Maps camelCase SecuritySettingsValues (from UI) to snake_case SessionSecuritySettings (for protocol)
 * @param settings - Settings from SecuritySettings component (camelCase)
 * @returns SessionSecuritySettings with snake_case keys for protocol
 */
export function mapSecuritySettings(settings: SecuritySettingsValues): SessionSecuritySettings {
  return {
    security_level: typeof settings.securityLevel === 'string' ? settings.securityLevel : 'Standard',
    secrecy_mode: settings.secrecyMode,
    crypto_params: {
      encryption_algorithm: settings.encryptionAlgorithm,
      kem_algorithm: settings.kemAlgorithm,
      sig_algorithm: settings.sigAlgorithm,
    },
    header_obfuscator_settings: normalizeHeaderObfuscatorSettings(settings.headerObfuscatorSettings)
  };
}

/**
 * Normalizes various input formats to the concrete HeaderObfuscatorSettings type
 * Handles: undefined, empty object, string, or object with EnabledWithKey
 */
export function normalizeHeaderObfuscatorSettings(
  settings: Record<string, string> | HeaderObfuscatorSettings | string | undefined
): HeaderObfuscatorSettings {
  // Handle undefined or empty
  if (!settings) {
    return "Disabled";
  }

  // Handle string values directly
  if (typeof settings === "string") {
    if (settings === "Disabled" || settings === "Enabled") {
      return settings;
    }
    // Unknown string, default to Disabled
    return "Disabled";
  }

  // Handle object cases
  if (typeof settings === "object" && settings !== null) {
    // Already properly typed EnabledWithKey object
    if (isVariant(settings as Record<string, unknown>, 'EnabledWithKey') && typeof (settings as Record<string, unknown>).EnabledWithKey === 'number') {
      return settings as { EnabledWithKey: number };
    }

    // Record<string, string> case like { EnabledWithKey: "12345" }
    const record: Record<string, string> = settings as Record<string, string>;
    if (record.EnabledWithKey) {
      return { EnabledWithKey: parseInt(record.EnabledWithKey, 10) };
    }

    // Empty object or unknown structure
    if (Object.keys(record).length === 0) {
      return "Disabled";
    }
  }

  return "Disabled";
}
