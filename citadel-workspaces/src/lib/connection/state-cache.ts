/**
 * Connection State Cache & Requests
 *
 * Pending requests, session cache, and connection attempt guards.
 * Extends ConnectionStateCore with caching and request tracking.
 */

import type { ActiveSessionsResult, SessionsAnswer } from './queries';
import type { PendingRequest } from './types';
import { CACHE_TTL_MS } from './constants';
import { ConnectionStateCore } from './state-core';

export class ConnectionState extends ConnectionStateCore {
  // Pending requests for response tracking
  private _pendingRequests: Map<string, PendingRequest> = new Map<string, PendingRequest>();

  // Session cache for deduplication
  private _pendingGetSessions: Promise<ActiveSessionsResult> | null = null;
  private _cachedSessions: SessionsAnswer | null = null;
  private _cachedSessionsTimestamp: number = 0;

  // Concurrency guard for connection attempts
  private _connectionAttempts: Set<string> = new Set<string>();

  // ============================================================================
  // Pending Requests
  // ============================================================================

  getPendingRequest(requestId: string): PendingRequest | undefined {
    return this._pendingRequests.get(requestId);
  }

  setPendingRequest(requestId: string, request: PendingRequest): void {
    this._pendingRequests.set(requestId, request);
  }

  deletePendingRequest(requestId: string): void {
    this._pendingRequests.delete(requestId);
  }

  hasPendingRequest(requestId: string): boolean {
    return this._pendingRequests.has(requestId);
  }

  // ============================================================================
  // Session Cache
  // ============================================================================

  get cachedSessions(): SessionsAnswer | null {
    return this._cachedSessions;
  }

  isCacheValid(): boolean {
    if (!this._cachedSessions) return false;
    return (Date.now() - this._cachedSessionsTimestamp) < CACHE_TTL_MS;
  }

  setCachedSessions(sessions: SessionsAnswer): void {
    this._cachedSessions = sessions;
    this._cachedSessionsTimestamp = Date.now();
  }

  invalidateCache(): void {
    this._cachedSessions = null;
    this._cachedSessionsTimestamp = 0;
  }

  get pendingGetSessions(): Promise<ActiveSessionsResult> | null {
    return this._pendingGetSessions;
  }

  setPendingGetSessions(promise: Promise<ActiveSessionsResult> | null): void {
    this._pendingGetSessions = promise;
  }

  // ============================================================================
  // Connection Attempts Guard
  // ============================================================================

  hasConnectionAttempt(key: string): boolean {
    return this._connectionAttempts.has(key);
  }

  addConnectionAttempt(key: string): void {
    this._connectionAttempts.add(key);
  }

  removeConnectionAttempt(key: string): void {
    this._connectionAttempts.delete(key);
  }
}
