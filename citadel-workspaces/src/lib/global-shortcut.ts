/**
 * Whether a page-wide keyboard shortcut may act on this keydown.
 *
 * A window or document listener hears every key on the page, including the ones typed into an
 * editor. Ctrl/Cmd+B bolded the selection in a document AND folded the sidebar: the canvas
 * editor's hidden textarea handled the key and called preventDefault, and the sidebar's window
 * listener checked neither that nor where the key came from. Every global shortcut asks here.
 *
 * Two rules, either one sufficient:
 * - The key was already handled (`defaultPrevented`): whoever handled it owned it. A window
 *   listener in the bubble phase runs after the target's own handlers, so it sees this.
 * - The key came from a surface that takes text -- an input, textarea, select, anything
 *   contenteditable (at any depth), or an ARIA textbox. That holds even when the surface lets
 *   the key through unhandled, and it looks through open shadow roots to the element that has
 *   focus, since a window listener sees a shadow host where the key really began inside it.
 */

const TEXT_TAGS: ReadonlySet<string> = new Set<string>(['INPUT', 'TEXTAREA', 'SELECT']);

/** Nodes are compared by nodeType, not instanceof: a key from an iframe or another realm is still an element. */
function elementOf(target: EventTarget | null): Element | null {
  const node: Node | null = target !== null && typeof (target as Node).nodeType === 'number' ? target as Node : null;
  if (node === null) return null;
  return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
}

/** contenteditable inherits: the nearest element that says either way decides. */
function insideContentEditable(el: Element): boolean {
  if ((el as HTMLElement).isContentEditable === true) return true;
  const decides: Element | null = el.closest('[contenteditable]');
  return decides !== null && decides.getAttribute('contenteditable') !== 'false';
}

/** Whether `target` is, or is inside, something a person types into. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el: Element | null = elementOf(target);
  if (el === null) return false;
  if (TEXT_TAGS.has(el.tagName)) return true;
  return insideContentEditable(el) || el.closest('[role="textbox"]') !== null;
}

/** Where the key began: the innermost element of its path, then into any open shadow root's focus. */
function keyOrigin(event: Event): EventTarget | null {
  let origin: EventTarget | null = event.composedPath()[0] ?? event.target;
  let el: Element | null = elementOf(origin);
  while (el?.shadowRoot?.activeElement) {
    el = el.shadowRoot.activeElement;
    origin = el;
  }
  return origin;
}

/** True when a page-wide shortcut may answer this key; false when it belongs to whatever had it first. */
export function globalShortcutMayFire(event: KeyboardEvent): boolean {
  return !event.defaultPrevented && !isEditableTarget(keyOrigin(event));
}
