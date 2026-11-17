/**
 * PollingService Base Class
 *
 * Abstract base class for services that need periodic polling functionality.
 * Provides standardized start/stop/poll lifecycle management.
 *
 * @example
 * class MyPollingService extends PollingService {
 *   protected getPollingIntervalMs(): number {
 *     return 5000; // Poll every 5 seconds
 *   }
 *
 *   protected async poll(): Promise<void> {
 *     const data = await this.fetchData();
 *     this.processData(data);
 *   }
 * }
 */

import { debugLog } from '../debug-config';

export abstract class PollingService {
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private isPaused: boolean = false;

  /**
   * Start the polling loop. No-op if already polling.
   */
  public startPolling(): void {
    if (this.pollingInterval) return;

    this.isPaused = false;
    this.pollingInterval = setInterval(() => {
      if (!this.isPaused) {
        this.poll().catch((error) => {
          debugLog('PollingService', `[${this.constructor.name}] Polling error:`, error);
        });
      }
    }, this.getPollingIntervalMs());

    debugLog('PollingService', `[${this.constructor.name}] Started polling (interval: ${this.getPollingIntervalMs()}ms)`);
  }

  /**
   * Stop the polling loop.
   */
  public stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      this.isPaused = false;
      debugLog('PollingService', `[${this.constructor.name}] Stopped polling`);
    }
  }

  /**
   * Temporarily pause polling without clearing the interval.
   * Useful for avoiding redundant polls during active operations.
   */
  public pausePolling(): void {
    this.isPaused = true;
  }

  /**
   * Resume polling after a pause.
   */
  public resumePolling(): void {
    this.isPaused = false;
  }

  /**
   * Check if polling is currently active.
   */
  public get isPolling(): boolean {
    return this.pollingInterval !== null && !this.isPaused;
  }

  /**
   * Trigger a single poll immediately (outside the interval).
   * Useful for manual refresh or event-triggered updates.
   */
  public async triggerPoll(): Promise<void> {
    try {
      await this.poll();
    } catch (error) {
      debugLog('PollingService', `[${this.constructor.name}] Manual poll error:`, error);
    }
  }

  /**
   * Restart polling with a new interval.
   * Useful when configuration changes.
   */
  public restartPolling(): void {
    this.stopPolling();
    this.startPolling();
  }

  /**
   * Get the polling interval in milliseconds.
   * Override this to return a dynamic or configurable interval.
   */
  protected abstract getPollingIntervalMs(): number;

  /**
   * The polling function to execute on each interval.
   * Implement your polling logic here.
   */
  protected abstract poll(): Promise<void>;
}

/**
 * Combined base class for services that need both event listening and polling.
 * Provides unified lifecycle management.
 */
import { EventListenerManager } from './event-listener-manager';

export abstract class EventListenerPollingService extends EventListenerManager {
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private isPaused: boolean = false;

  /**
   * Start both event listeners and polling.
   */
  public start(): void {
    this.reinitialize();
    this.startPolling();
  }

  /**
   * Stop both event listeners and polling.
   */
  public stop(): void {
    this.stopPolling();
    this.teardown();
  }

  public startPolling(): void {
    if (this.pollingInterval) return;

    this.isPaused = false;
    this.pollingInterval = setInterval(() => {
      if (!this.isPaused) {
        this.poll().catch((error) => {
          debugLog('PollingService', `[${this.constructor.name}] Polling error:`, error);
        });
      }
    }, this.getPollingIntervalMs());
  }

  public stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      this.isPaused = false;
    }
  }

  public pausePolling(): void {
    this.isPaused = true;
  }

  public resumePolling(): void {
    this.isPaused = false;
  }

  public get isPolling(): boolean {
    return this.pollingInterval !== null && !this.isPaused;
  }

  public async triggerPoll(): Promise<void> {
    try {
      await this.poll();
    } catch (error) {
      debugLog('PollingService', `[${this.constructor.name}] Manual poll error:`, error);
    }
  }

  protected abstract getPollingIntervalMs(): number;
  protected abstract poll(): Promise<void>;
}
