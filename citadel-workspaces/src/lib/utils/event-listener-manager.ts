/**
 * EventListenerManager Base Class
 *
 * Abstract base class for services that need to manage event subscriptions
 * with automatic cleanup. Prevents listener accumulation on HMR/reload.
 *
 * @example
 * class MyService extends EventListenerManager {
 *   constructor() {
 *     super();
 *     this.setupEventListeners();
 *   }
 *
 *   protected setupEventListeners(): void {
 *     this.listen('user:login', (data) => this.handleLogin(data));
 *     this.listen('user:logout', () => this.handleLogout());
 *   }
 *
 *   // Call teardown() when service is destroyed
 * }
 */

import { eventEmitter } from '../event-emitter';

export abstract class EventListenerManager {
  private cleanupFunctions: (() => void)[] = [];
  private isSetup: boolean = false;

  /**
   * Subscribe to an event with automatic cleanup tracking.
   * @param event - Event name to listen for
   * @param handler - Event handler function
   */
  protected listen<T>(event: string, handler: (data: T) => void): void {
    const unsubscribe: () => void = eventEmitter.on(event, handler);
    this.cleanupFunctions.push(unsubscribe);
  }

  /**
   * Subscribe to an event once with automatic cleanup tracking.
   * @param event - Event name to listen for
   * @param handler - Event handler function (called only once)
   */
  protected listenOnce<T>(event: string, handler: (data: T) => void): void {
    const unsubscribe: () => void = eventEmitter.once(event, handler);
    this.cleanupFunctions.push(unsubscribe);
  }

  /**
   * Emit an event through the event emitter.
   * @param event - Event name to emit
   * @param data - Data to pass to handlers
   */
  protected emit<T>(event: string, data?: T): void {
    eventEmitter.emit(event, data);
  }

  /**
   * Clean up all event listeners. Call this when the service is destroyed.
   */
  public teardown(): void {
    for (const cleanup of this.cleanupFunctions) {
      cleanup();
    }
    this.cleanupFunctions = [];
    this.isSetup = false;
  }

  /**
   * Re-initialize event listeners after teardown.
   * Calls teardown first to prevent duplicates.
   */
  protected reinitialize(): void {
    this.teardown();
    this.setupEventListeners();
    this.isSetup = true;
  }

  /**
   * Check if event listeners are currently set up.
   */
  protected get isListening(): boolean {
    return this.isSetup;
  }

  /**
   * Number of active listeners (for debugging).
   */
  protected get listenerCount(): number {
    return this.cleanupFunctions.length;
  }

  /**
   * Implement this method to set up event listeners using listen() and listenOnce().
   * This is called during initialization and reinitialize().
   */
  protected abstract setupEventListeners(): void;
}
