/**
 * The internal-HTTP frames addressed to one instance, subscribed from launch. A call the app makes
 * in app_init can be answered before the handle hears that init returned: the worker posts the
 * call, then `loaded`, and the answer can land in between. So frames are held until `open()` (init
 * succeeded) and then forwarded in arrival order; `close()` drops what is held and unsubscribes,
 * and nothing is forwarded after it. The hold lasts no longer than app_init, which the watchdog
 * stops at the compute budget; what it holds is what a running instance forwards uncapped anyway.
 */
import type { IhttpPort, InboundIhttpFrame } from './ports';

export class IhttpInbox {
  private held: InboundIhttpFrame[] = [];
  private opened: boolean = false;
  private closed: boolean = false;
  private unsubscribe: (() => void) | null;

  constructor(port: IhttpPort | undefined, private readonly forward: (inbound: InboundIhttpFrame) => void) {
    this.unsubscribe = port?.onFrame((inbound: InboundIhttpFrame): void => this.arrive(inbound)) ?? null;
  }

  open(): void {
    if (this.opened || this.closed) return;
    this.opened = true;
    const held: InboundIhttpFrame[] = this.held;
    this.held = [];
    for (const inbound of held) this.forward(inbound);
  }

  close(): void {
    this.closed = true;
    this.held = [];
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private arrive(inbound: InboundIhttpFrame): void {
    if (this.closed) return;
    if (this.opened) this.forward(inbound);
    else this.held.push(inbound);
  }
}
