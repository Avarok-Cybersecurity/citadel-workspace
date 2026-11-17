/**
 * Group Messaging Manager
 *
 * Manages group chat message state and handles incoming message notifications.
 * Provides a reactive interface for UI components to subscribe to message updates.
 */

import type { GroupMessage } from '@/types/workspace-entities';
import { TypedEventEmitter } from './event-emitter';
import { debugLog } from '@/lib/debug-config';
import { sortByTime, mergeOlder, applyEdit, removeMessage, reactToGroupMessage } from './group-message-list';
import type { MessageReaction, ReactionChange } from './reactions/reaction-state';

export interface GroupMessageEvent {
  type: 'new_message' | 'message_edited' | 'message_deleted' | 'message_reacted' | 'messages_loaded';
  groupId: string;
  message?: GroupMessage;
  messages?: GroupMessage[];
  messageId?: string;
  hasMore?: boolean;
}

export interface GroupMessagesState {
  messages: GroupMessage[];
  hasMore: boolean;
  loading: boolean;
  error?: string;
}

/**
 * Group Messaging Manager class
 * Singleton that manages all group chat state and events
 */
class GroupMessagingManagerClass {
  private static instance: GroupMessagingManagerClass;
  private eventEmitter: TypedEventEmitter<GroupMessageEvent>;
  private groupMessages: Map<string, GroupMessagesState>;

  private constructor() {
    this.eventEmitter = new TypedEventEmitter<GroupMessageEvent>();
    this.groupMessages = new Map();
  }

  public static getInstance(): GroupMessagingManagerClass {
    if (!GroupMessagingManagerClass.instance) {
      GroupMessagingManagerClass.instance = new GroupMessagingManagerClass();
    }
    return GroupMessagingManagerClass.instance;
  }

  /**
   * Get the current messages for a group
   */
  public getMessages(groupId: string): GroupMessagesState {
    return this.groupMessages.get(groupId) || {
      messages: [],
      hasMore: true,
      loading: false
    };
  }

  /**
   * Handle new message notification from server
   */
  public handleNewMessage(groupId: string, message: GroupMessage): void {
    const current: GroupMessagesState = this.getMessages(groupId);

    // Check for duplicate message by ID
    if (current.messages.some(m => m.id === message.id)) {
      debugLog('GroupMessagingManager', '[GroupMessagingManager] Skipping duplicate message:', message.id);
      return;
    }

    // Add new message to the end (newest at bottom)
    const messages: GroupMessage[] = [...current.messages, message];

    this.groupMessages.set(groupId, {
      ...current,
      messages
    });

    this.eventEmitter.emit({
      type: 'new_message',
      groupId,
      message
    });
  }

  /**
   * Groups with a "load older" request in flight, so the response that comes
   * back is merged into the thread instead of replacing it.
   */
  private readonly pendingOlder: Set<string> = new Set<string>();

  /** Called before requesting an older page. Consumed by the next response. */
  public markLoadingOlder(groupId: string): void {
    this.pendingOlder.add(groupId);
  }

  /** Called when a pagination request fails, so a later full load is not merged. */
  public clearLoadingOlder(groupId: string): void {
    this.pendingOlder.delete(groupId);
  }

  public handleMessagesLoaded(
    groupId: string,
    messages: GroupMessage[],
    hasMore: boolean,
    prepend: boolean = false
  ): void {
    const current: GroupMessagesState = this.getMessages(groupId);
    const sortedMessages: GroupMessage[] = sortByTime(messages);

    // `prepend` defaulted to false and its ONE caller never passed it, so the
    // half that pages was dead: scrolling up in a group chat replaced the whole
    // transcript with the older page, and everything newer vanished from screen
    // until a new message arrived or the user reloaded. The response carries no
    // pagination cursor to correlate on, so the manager records the request.
    const paginating: boolean = prepend || this.pendingOlder.delete(groupId);

    const newMessages: GroupMessage[] = paginating
      ? mergeOlder(current.messages, sortedMessages)
      : sortedMessages;

    this.groupMessages.set(groupId, {
      messages: newMessages,
      hasMore,
      loading: false
    });

    this.eventEmitter.emit({
      type: 'messages_loaded',
      groupId,
      messages: newMessages,
      hasMore
    });
  }

  /**
   * Handle message edited notification
   */
  public handleMessageEdited(
    groupId: string,
    messageId: string,
    newContent: string,
    editedAt: bigint
  ): void {
    const current: GroupMessagesState = this.getMessages(groupId);

    const messages: GroupMessage[] = applyEdit(current.messages, messageId, newContent, editedAt);

    this.groupMessages.set(groupId, {
      ...current,
      messages
    });

    const editedMessage: GroupMessage | undefined = messages.find(m => m.id === messageId);
    this.eventEmitter.emit({
      type: 'message_edited',
      groupId,
      messageId,
      message: editedMessage
    });
  }

  /**
   * Handle message deleted notification
   */
  public handleMessageDeleted(groupId: string, messageId: string): void {
    const current: GroupMessagesState = this.getMessages(groupId);

    const messages: GroupMessage[] = removeMessage(current.messages, messageId);

    this.groupMessages.set(groupId, {
      ...current,
      messages
    });

    this.eventEmitter.emit({
      type: 'message_deleted',
      groupId,
      messageId
    });
  }

  /** A reaction changed; a no-op when the message is not held here or the change is a redelivery. */
  public handleReactionChanged(groupId: string, messageId: string, change: ReactionChange): void {
    const current: GroupMessagesState = this.getMessages(groupId);
    const messages: GroupMessage[] | null = reactToGroupMessage(current.messages, messageId, change);
    if (!messages) return;
    this.groupMessages.set(groupId, { ...current, messages });
    this.eventEmitter.emit({ type: 'message_reacted', groupId, messageId, message: messages.find((m) => m.id === messageId) });
  }

  /** A node channel's notice: `reactions` is the message's whole list after the change. */
  public handleReactionsReplaced(groupId: string, messageId: string, reactions: MessageReaction[]): void {
    const current: GroupMessagesState = this.getMessages(groupId);
    if (!current.messages.some((m) => m.id === messageId)) return;
    const messages: GroupMessage[] = current.messages.map((m) => (m.id === messageId ? { ...m, reactions } : m));
    this.groupMessages.set(groupId, { ...current, messages });
    this.eventEmitter.emit({ type: 'message_reacted', groupId, messageId, message: messages.find((m) => m.id === messageId) });
  }

  /**
   * Subscribe to group message events
   */
  public subscribe(callback: (event: GroupMessageEvent) => void): () => void {
    return this.eventEmitter.subscribe(callback);
  }

  /**
   * Subscribe to events for a specific group
   */
  public subscribeToGroup(
    groupId: string,
    callback: (event: GroupMessageEvent) => void
  ): () => void {
    return this.eventEmitter.subscribe((event) => {
      if (event.groupId === groupId) {
        callback(event);
      }
    });
  }

  /**
   * Clear messages for a group
   */
  public clearGroup(groupId: string): void {
    this.groupMessages.delete(groupId);
  }

  /**
   * Clear all group messages
   */
  public clearAll(): void {
    this.groupMessages.clear();
  }

  /**
   * Get oldest timestamp for pagination
   */
  public getOldestTimestamp(groupId: string): bigint | undefined {
    const state: GroupMessagesState = this.getMessages(groupId);
    if (state.messages.length === 0) return undefined;
    return state.messages[0].timestamp;
  }
}

export const groupMessagingManager: GroupMessagingManagerClass = GroupMessagingManagerClass.getInstance();
export default groupMessagingManager;
