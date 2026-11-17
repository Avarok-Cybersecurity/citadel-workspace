/**
 * TEST FAKE: the workspace server's ihttp relay between members' app instances. A client frame to
 * `user:<name>` of an app reaches that member's instance of that app, stamped with the sender and
 * the sender's app as `Caller` (the kernel's word, never the body's); a frame back reaches the
 * caller's instance the same way. A
 * member who is not online is `no_host`, as the relay answers. Delivery is asynchronous, as it is
 * over a session; frames between two members keep their order.
 */
import type { IhttpPort, InboundIhttpFrame, PortAnswer } from '@/lib/citadel-apps/host/ports';
import type { Caller } from '@/lib/citadel-apps/sdk/generated/Caller';
import type { IhttpFrame } from '@/lib/citadel-apps/sdk/generated/IhttpFrame';

const CALENDAR: string = 'net.avarok.calendar';
const at = (username: string, app: string): string => `${username}\n${app}`;

export class IhttpRelay {
  private readonly listeners: Map<string, (f: InboundIhttpFrame) => void> = new Map();
  /** Every frame the relay carried, in order, for a test that counts them. */
  readonly carried: { from: string; to: string; frame: IhttpFrame }[] = [];

  private caller(username: string, app: string): Caller {
    return { username, cid: BigInt(username.length), app_id: app, install_id: `install-${app}-${username}`, via: 'relay' };
  }

  private deliver(from: string, app: string, to: string, toApp: string, frame: IhttpFrame): PortAnswer<null> {
    const listener: ((f: InboundIhttpFrame) => void) | undefined = this.listeners.get(at(to, toApp));
    if (listener === undefined) return { refused: { unavailable: 'no_host' } };
    this.carried.push({ from, to, frame });
    setTimeout((): void => listener({ from: this.caller(from, app), frame }), 0);
    return { ok: null };
  }

  /** `username`'s Calendar instances have all closed: the relay answers `no_host` for them. */
  offline(username: string): void {
    this.listeners.delete(at(username, CALENDAR));
  }

  /** The ihttp port of `username`'s Calendar instance; it is online once the instance listens. */
  port(username: string): IhttpPort {
    return this.appPort(username, CALENDAR);
  }

  /** The ihttp port of `username`'s instance of `app`. */
  appPort(username: string, app: string): IhttpPort {
    return {
      IhttpServe: () => ({ ok: null }),
      IhttpCall: ({ to, frame }) => ('user' in to ? this.deliver(username, app, to.user.username, to.user.app_id, frame) : { refused: { unavailable: 'no_host' } }),
      respond: (peer: Caller, frame: IhttpFrame) => this.deliver(username, app, peer.username, peer.app_id, frame),
      onFrame: (listener: (f: InboundIhttpFrame) => void) => {
        this.listeners.set(at(username, app), listener);
        return (): void => { this.listeners.delete(at(username, app)); };
      },
    };
  }
}
