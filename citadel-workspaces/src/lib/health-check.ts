import { websocketService } from './websocket-service';
import { eventEmitter } from './event-emitter';
import { PollingService } from './utils/polling-service';
import { INTERVAL } from './timeout-constants';
import { debugLog } from './debug-config';

/** How often to re-probe while waiting for the service to become healthy. */
const HEALTH_POLL_INTERVAL_MS: number = 1000;

export interface ServiceHealth {
  isHealthy: boolean;
  lastCheck: number;
  error?: string;
}

const DEFAULT_INTERVAL_MS: number = INTERVAL.HEALTH_CHECK_MS;

class HealthCheckService extends PollingService {
  private static instance: HealthCheckService;
  private health: ServiceHealth = {
    isHealthy: false,
    lastCheck: 0
  };
  private intervalMs: number = DEFAULT_INTERVAL_MS;

  private constructor() {
    super();
  }

  public static getInstance(): HealthCheckService {
    if (!HealthCheckService.instance) {
      HealthCheckService.instance = new HealthCheckService();
    }
    return HealthCheckService.instance;
  }

  protected getPollingIntervalMs(): number {
    return this.intervalMs;
  }

  protected async poll(): Promise<void> {
    await this.checkHealth();
  }

  /**
   * Perform a health check by attempting to connect to the WebSocket
   */
  public async checkHealth(): Promise<ServiceHealth> {
    try {
      // `canSendRequests`, not `isConnected`. The latter asks whether THIS tab
      // owns a WASM client, and a follower tab never does -- one WebSocket per
      // browser, followers proxy through the leader. Probing it here meant
      // every tab but one reported the local agent unreachable, for ever,
      // while everything worked: a red "Can't reach the Citadel agent" banner
      // permanently pinned in the app's own documented multi-tab mode.
      //
      // core.ts already carries this distinction, with a comment describing the
      // identical bug in `fetchActiveSessions`. The rule was written down and
      // this caller was never brought along.
      const canReachAgent: boolean = websocketService.canSendRequests();

      this.health = {
        isHealthy: canReachAgent,
        lastCheck: Date.now()
      };

      eventEmitter.emit('service-health', this.health);
      return this.health;
    } catch (error) {
      this.health = {
        isHealthy: false,
        lastCheck: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      eventEmitter.emit('service-health', this.health);
      return this.health;
    }
  }

  /**
   * Start periodic health checks
   */
  public startHealthChecks(intervalMs: number = DEFAULT_INTERVAL_MS): void {
    this.intervalMs = intervalMs;
    this.stopPolling();

    // Initial check
    this.checkHealth().catch((err: unknown) => debugLog('HealthCheck', 'checkHealth failed:', err));

    // Start periodic checks via base class
    this.startPolling();
  }

  /**
   * Stop periodic health checks
   */
  public stopHealthChecks(): void {
    this.stopPolling();
  }

  /**
   * Get current health status without performing a check
   */
  public getHealth(): ServiceHealth {
    return this.health;
  }

  /**
   * Wait for service to be healthy with timeout
   */
  public async waitForHealthy(timeoutMs: number = 30000): Promise<void> {
    const startTime: number = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const health: ServiceHealth = await this.checkHealth();

      if (health.isHealthy) {
        return;
      }

      // A real delay, deliberately. There is no push signal for "the service came
      // up", so this polls; the interval exists to avoid hammering a service that
      // is already struggling. Not a settling hack — see lib/utils/scheduling.ts.
      await new Promise(resolve => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
    }

    throw new Error(`Service did not become healthy within ${timeoutMs}ms`);
  }
}

export const healthCheckService: HealthCheckService = HealthCheckService.getInstance();
