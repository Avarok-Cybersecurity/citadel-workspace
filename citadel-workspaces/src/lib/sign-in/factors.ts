/**
 * Turning what the user offered into a Connect's factor fields. Pure.
 */
import { stringToBytes } from '@/lib/utils/encoding-utils';
import type { ConnectFactorFields, SignInFactors } from './types';

/** A password sign-in from a window that cannot touch a key (an unattended reconnect). */
export const passwordOnly = (password: string): SignInFactors =>
  ({ password, securityKey: false, recoveryCode: null, admissionToken: null });

export function connectFactorFields(factors: SignInFactors): ConnectFactorFields {
  const code: string | null = factors.recoveryCode === null ? null : factors.recoveryCode.trim();
  if (code !== null && code.length === 0) throw new Error('A recovery code is required');
  if (factors.password === null && code === null && !factors.securityKey) {
    throw new Error('A sign-in needs a password, a security key or a recovery code');
  }
  return {
    password: factors.password === null ? null : stringToBytes(factors.password),
    security_key: factors.securityKey,
    recovery_code: code === null ? null : stringToBytes(code),
    admission_token: factors.admissionToken,
  };
}

/**
 * The server a session lives on, as the key for its local records: lowercased,
 * without a scheme or a trailing slash. Two tenants on one host keep their path.
 */
export function tenantOf(serverAddress: string): string {
  const trimmed: string = serverAddress.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/+$/, '');
  if (!trimmed) throw new Error('A session with no server address has no tenant');
  return trimmed;
}
