/**
 * The test addresses of the pane's landmarks, per kind of conversation.
 *
 * One pane renders every chat now, but the specs that drive a direct chat and the ones that
 * drive a node channel were written against two components and address them by different ids
 * (`p2p-message-input`, `group-message-input`, ...). Keeping each kind's ids means every one of
 * those specs keeps finding what it drives, instead of a rename silently aiming them at nothing.
 */
import type { ChatKind } from '@/lib/chat/transport/chat-transport';

/** The attribute itself, spread onto the element, so the id is written where the static gates read it. */
export interface TestIdAttribute {
  readonly 'data-testid': string;
}

export interface PaneTestIds {
  readonly root: TestIdAttribute;
  readonly log: TestIdAttribute;
  readonly input: TestIdAttribute;
  readonly restricted: TestIdAttribute;
  /** The browser file picker of a conversation of many. */
  readonly picker: TestIdAttribute;
}

const PEER: PaneTestIds = {
  root: { 'data-testid': 'p2p-chat' },
  log: { 'data-testid': 'p2p-chat-view' },
  input: { 'data-testid': 'p2p-message-input' },
  restricted: { 'data-testid': 'p2p-send-restricted' },
  picker: { 'data-testid': 'p2p-file-input' },
};
const GROUP: PaneTestIds = {
  root: { 'data-testid': 'group-chat' },
  log: { 'data-testid': 'group-chat-view' },
  input: { 'data-testid': 'group-message-input' },
  restricted: { 'data-testid': 'group-send-restricted' },
  picker: { 'data-testid': 'group-file-input' },
};

export function paneTestIds(kind: ChatKind): PaneTestIds {
  return kind === 'peer' ? PEER : GROUP;
}
