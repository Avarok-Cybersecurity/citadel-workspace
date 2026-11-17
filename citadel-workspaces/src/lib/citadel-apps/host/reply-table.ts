/**
 * Reply handles for one instance. A handle is issued per host call, ready at once or pending until
 * its port answers, and is read exactly once: `reply_read` copies and releases it. Live handles are
 * capped, and a READY reply not read within `ttlMs` is released (the guest SDK abandons a reply it
 * cannot reserve memory for, and no ABI call releases a handle), so a guest cannot pin host memory.
 * Pending replies do not expire here: the dispatcher bounds them with the port's own timeout.
 */
import { ABI_ERROR } from './abi';

type Slot = { readonly state: 'ready'; readonly bytes: Uint8Array; readonly readyAt: number } | { readonly state: 'pending' };

const MAX_HANDLE: number = 0x7fff_ffff;

export class ReplyTable {
  private readonly slots: Map<number, Slot> = new Map<number, Slot>();
  private next: number = 0;

  constructor(private readonly maxLive: number, private readonly ttlMs: number, private readonly now: () => number) {}

  get live(): number {
    return this.slots.size;
  }

  /** Replies issued whose port has not answered yet: what a closing instance still waits on. */
  get pendingCount(): number {
    let n: number = 0;
    for (const slot of this.slots.values()) if (slot.state === 'pending') n++;
    return n;
  }

  /** A handle for bytes that are ready now, or HANDLES_EXHAUSTED. */
  ready(bytes: Uint8Array): number {
    return this.issue({ state: 'ready', bytes, readyAt: this.now() });
  }

  /** A handle whose reply arrives later through `resolve`, or HANDLES_EXHAUSTED. */
  pending(): number {
    return this.issue({ state: 'pending' });
  }

  /** Fills a pending handle. False when the handle is not pending (released, or never issued). */
  resolve(handle: number, bytes: Uint8Array): boolean {
    if (this.slots.get(handle)?.state !== 'pending') return false;
    this.slots.set(handle, { state: 'ready', bytes, readyAt: this.now() });
    return true;
  }

  length(handle: number): number {
    this.sweep();
    const slot: Slot | undefined = this.slots.get(handle);
    if (slot === undefined) return ABI_ERROR.UNKNOWN_HANDLE;
    return slot.state === 'pending' ? ABI_ERROR.PENDING : slot.bytes.byteLength;
  }

  /** Copies the reply into memory at ptr and releases the handle; returns the bytes copied. */
  read(handle: number, memory: WebAssembly.Memory, ptr: number, cap: number): number {
    this.sweep();
    const slot: Slot | undefined = this.slots.get(handle);
    if (slot === undefined) return ABI_ERROR.UNKNOWN_HANDLE;
    if (slot.state === 'pending') return ABI_ERROR.PENDING;
    if (cap < slot.bytes.byteLength) return ABI_ERROR.BUFFER_TOO_SMALL;
    if (!inBounds(memory, ptr, slot.bytes.byteLength)) return ABI_ERROR.BAD_REQUEST;
    new Uint8Array(memory.buffer, ptr, slot.bytes.byteLength).set(slot.bytes);
    this.slots.delete(handle);
    return slot.bytes.byteLength;
  }

  /** Releases every ready reply older than the TTL. */
  sweep(): void {
    const cutoff: number = this.now() - this.ttlMs;
    for (const [handle, slot] of this.slots) if (slot.state === 'ready' && slot.readyAt <= cutoff) this.slots.delete(handle);
  }

  private issue(slot: Slot): number {
    this.sweep();
    if (this.slots.size >= this.maxLive) return ABI_ERROR.HANDLES_EXHAUSTED;
    do {
      this.next = this.next >= MAX_HANDLE ? 1 : this.next + 1;
    } while (this.slots.has(this.next));
    this.slots.set(this.next, slot);
    return this.next;
  }
}

/** Whether [ptr, ptr+len) lies inside the memory, with ptr and len as the guest's u32 values. */
export function inBounds(memory: WebAssembly.Memory, ptr: number, len: number): boolean {
  return Number.isInteger(ptr) && Number.isInteger(len) && ptr >= 0 && len >= 0 && ptr + len <= memory.buffer.byteLength;
}
