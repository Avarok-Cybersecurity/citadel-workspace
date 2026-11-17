/**
 * Permissions Service - Service Class
 *
 * Singleton that fetches, caches, and provides permission checks.
 * Extends EventListenerManager for automatic event listener cleanup.
 */

import { requestPermissions } from './request-permissions';
import { currentUserIdSync, resolveCurrentUserId as resolveUserId } from './current-user';
import { EventListenerManager } from '@/lib/utils/event-listener-manager';
import { debugLog } from '@/lib/debug-config';
import { INTERVAL } from '@/lib/timeout-constants';

import { Permission, PERMISSION_LABELS } from './types';
import type { UserRole, DomainPermissions } from './types';
import {
  updateCacheEntry,
  hasPermission as cacheHasPermission,
  hasAnswerFor as cacheHasAnswerFor,
  getDeniedReason as cacheGetDeniedReason,
} from './cache';

/**
 * Permissions Service singleton
 */
export class PermissionsService extends EventListenerManager {
  private static instance: PermissionsService;
  private cache: Map<string, DomainPermissions> = new Map();
  private pendingRequests: Map<string, Promise<DomainPermissions>> = new Map();
  /**
   * Why the last fetch for a domain did not produce permissions.
   *
   * Nobody signed in, no answer, and a throw on the way are three different
   * things that reached the caller as one silence. The service knows which
   * branch it took at the moment it takes it.
   */
  private lastFailure: Map<string, string> = new Map();
  private initialized: boolean = false;

  private constructor() {
    super();
    this.setupEventListeners();
  }

  public static getInstance(): PermissionsService {
    if (!PermissionsService.instance) {
      PermissionsService.instance = new PermissionsService();
    }
    return PermissionsService.instance;
  }

  /**
   * Setup event listeners for permission updates.
   */
  protected setupEventListeners(): void {
    this.listen<{
      userId: string;
      role: UserRole;
      permissions: string[];
      domainId: string;
    }>('user:permissions:loaded', (payload) => {
      // Synchronous fast path FIRST. Resolving asynchronously in every case
      // filled the cache a tick later than it used to, and consumers that read
      // straight after this event — the permissions settings tab among them —
      // began rendering against an empty cache.
      //
      // The async fallback exists because the synchronous accessor is null for a
      // user who logged IN rather than registering, which made this equality
      // check fail for every response and left the cache permanently empty.
      if (payload.userId === this.getCurrentUserId()) {
        updateCacheEntry(this.cache, payload.domainId, payload.role, payload.permissions);
        // Emitted on BOTH paths. It used to be async-only, on the reasoning
        // that the synchronous path had already filled the cache "before any
        // listener could observe it missing" -- true of listeners that run
        // after this one, and not of anybody waiting on the load event itself,
        // whose handler may be registered first. Announcing the fill from the
        // place that does the filling is what stops the answer depending on
        // listener order.
        this.emit('permissions:updated', { domainId: payload.domainId });
        return;
      }

      void this.isCurrentUser(payload.userId).then((mine) => {
        if (mine) {
          updateCacheEntry(this.cache, payload.domainId, payload.role, payload.permissions);
          this.emit('permissions:updated', { domainId: payload.domainId });
        }
      });
    });

    // A permission belongs to a SESSION, and this cache is keyed by domain
    // alone in a singleton that outlives every account. `workspace-root` is the
    // same id for everyone, so after switching accounts the previous account's
    // rights answered for up to the cache's lifetime -- long enough to render a
    // control the new account may not use, or hide one it may.
    this.listen<{ cid: bigint | null }>('instance:cid-changed', () => {
      this.clearCache();
    });

    // This carries PERMISSION changes too, not only role changes.
    //
    // The server says why at its `UpdateMemberPermissions` handler: "`Success`
    // carries no user id, so the broadcast is the role-shaped notification with
    // the member's CURRENT role -- what the client needs is 'your permissions
    // moved, drop your cache', and the role is how it identifies whose."
    //
    // There used to be a second listener beside this one for
    // `member:permissions-updated`, which nothing emits and nothing was going
    // to: it read as THE permissions-refresh path, so the obvious repair was to
    // start emitting it, which would have refreshed twice for one change.
    // Deleted, and the reason recorded here where the surviving path is.
    this.listen<{ userId: string; role: UserRole }>('member:role-updated', (payload) => {
      void this.isCurrentUser(payload.userId).then((mine) => {
        if (mine) {
          this.clearCache();
          this.emit('permissions:role-changed', { role: payload.role });
        }
      });
    });

    this.initialized = true;
  }

  /** See current-user; both are thin so the event listeners read the same way. */
  private getCurrentUserId(): string | null { return currentUserIdSync(); }
  private async isCurrentUser(userId: string): Promise<boolean> { return userId === (await resolveUserId()); }
  private async resolveCurrentUserId(): Promise<string | null> { return resolveUserId(); }

  /**
   * Fetch permissions for a specific domain.
   */
  public async fetchPermissions(domainId: string, forceRefresh: boolean = false): Promise<DomainPermissions | null> {
    if (!forceRefresh) {
      const cached: DomainPermissions | undefined = this.cache.get(domainId);
      if (cached && Date.now() - cached.lastUpdated < INTERVAL.PERMISSION_CACHE_MS) {
        return cached;
      }
    }

    const pending: Promise<DomainPermissions> | undefined = this.pendingRequests.get(domainId);
    if (pending) return pending;

    const userId: string | null = await this.resolveCurrentUserId();
    if (!userId) {
      debugLog('PermissionsService', 'No current user, cannot fetch permissions');
      this.lastFailure.set(domainId, 'nobody is signed in on this tab');
      return null;
    }

    const requestPromise: Promise<DomainPermissions> = requestPermissions(
      domainId, userId, this.cache, this.lastFailure, this.pendingRequests,
    );

    this.pendingRequests.set(domainId, requestPromise);
    return requestPromise;
  }

  /** Why the last fetch for this domain produced nothing, if it produced nothing. */
  public getLastFailure(domainId: string): string | null {
    return this.lastFailure.get(domainId) ?? null;
  }

  // ─── Permission Checks (delegated to cache module) ───────────────

  public hasPermission(domainId: string, permission: Permission): boolean {
    return cacheHasPermission(this.cache, domainId, permission);
  }

  /** Whether any answer for this domain has been stored -- see `hasAnswerFor`. */
  public hasAnswerFor(domainId: string): boolean {
    return cacheHasAnswerFor(this.cache, domainId);
  }

  public hasAnyPermission(domainId: string, permissions: Permission[]): boolean {
    return permissions.some((p) => this.hasPermission(domainId, p));
  }

  public hasAllPermissions(domainId: string, permissions: Permission[]): boolean {
    return permissions.every((p) => this.hasPermission(domainId, p));
  }

  public getPermissions(domainId: string): DomainPermissions | null {
    return this.cache.get(domainId) || null;
  }

  public getAllCachedPermissions(): Map<string, DomainPermissions> {
    return new Map(this.cache);
  }

  // `getRole`/`isAdmin`/`isOwner`/`isPrivileged` compared role NAMES and are gone: roles are an
  // editable table, so a gate asks for the permission it needs (usePermission), and a display
  // reads the role from the table by `currentUser.roleId`.

  public clearCache(): void {
    this.cache.clear();
    debugLog('PermissionsService', 'Cache cleared');
    // Announced, so the provider's copy is dropped too. A session change cleared this and
    // told nobody: the provider still held the domain, usePermission never asked again,
    // and the empty cache's "no answer" permitted a Member the tree's "+" (measured live).
    this.emit('permissions:cleared', {});
  }

  public cleanup(): void {
    this.clearCache();
    this.teardown();
    this.initialized = false;
  }

  public getPermissionLabel(permission: Permission): string {
    return PERMISSION_LABELS[permission] || permission;
  }

  public getDeniedReason(domainId: string, permission: Permission): string {
    return cacheGetDeniedReason(this.cache, domainId, permission);
  }
}
