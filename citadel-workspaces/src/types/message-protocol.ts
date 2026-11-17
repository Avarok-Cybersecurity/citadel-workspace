/**
 * Message Protocol Types
 *
 * This defines a subprotocol for peer-to-peer messaging within the workspace protocol.
 * The contents of WorkspaceProtocolRequest::Message { contents: Vec<u8> } will be
 * serialized versions of these types.
 */

// Message content types - determines how the message is rendered
// 'system_notice': a line the app writes into the thread (e.g. a screenshot notice), not a bubble anyone typed.
export type MessageType = 'text' | 'markdown' | 'live_document' | 'file_transfer' | 'system_notice';

// Message event types that can be sent between peers
export type MessageEventType = 
  | { type: 'TextMessage'; data: TextMessageData }
  | { type: 'FileMessage'; data: FileMessageData }
  | { type: 'MessageDelivered'; data: MessageDeliveredData }
  | { type: 'MessageRead'; data: MessageReadData }
  | { type: 'TypingIndicator'; data: TypingIndicatorData }
  | { type: 'UserPresence'; data: UserPresenceData }
  | { type: 'ReactionAdded'; data: ReactionData }
  | { type: 'ReactionRemoved'; data: ReactionData }
  | { type: 'MessageEdited'; data: MessageEditedData }
  | { type: 'MessageDeleted'; data: MessageDeletedData }
  | { type: 'CallInvite'; data: CallInviteData }
  | { type: 'ScreenShareStarted'; data: ScreenShareData }
  | { type: 'ScreenShareEnded'; data: ScreenShareData };

// Individual message data types
export interface TextMessageData {
  id: string;                    // Unique message ID
  message_type: MessageType;     // Content type (text, markdown, live_document)
  text: string;                  // Message content
  timestamp: number;             // Unix timestamp
  replyTo?: string;             // ID of message being replied to
  mentions?: string[];          // User IDs mentioned in the message
  metadata?: Record<string, unknown>; // Additional metadata
  // Live document specific fields (only when message_type === 'live_document')
  document_id?: string;          // Unique ID for the collaborative document
  document_title?: string;       // User-provided title for the document
}

export interface FileMessageData {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  thumbnailUrl?: string;
  downloadUrl: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface MessageDeliveredData {
  messageId: string;
  deliveredTo: string;          // User ID who received the message
  timestamp: number;
}

export interface MessageReadData {
  messageId: string;
  readBy: string;               // User ID who read the message
  timestamp: number;
}

export interface TypingIndicatorData {
  isTyping: boolean;
  userId: string;
  location: {                   // Where the user is typing
    nodeId?: string;
  };
}

export interface UserPresenceData {
  userId: string;
  status: 'online' | 'away' | 'busy' | 'offline';
  lastSeen?: number;
  statusMessage?: string;
}

export interface ReactionData {
  messageId: string;
  userId: string;
  emoji: string;
  timestamp: number;
}

export interface MessageEditedData {
  messageId: string;
  newText: string;
  editedAt: number;
  editedBy: string;
}

export interface MessageDeletedData {
  messageId: string;
  deletedAt: number;
  deletedBy: string;
}

export interface CallInviteData {
  callId: string;
  callType: 'audio' | 'video';
  initiatorId: string;
  participantIds: string[];
  timestamp: number;
}

export interface ScreenShareData {
  userId: string;
  sessionId: string;
  timestamp: number;
}

// Helper functions for working with message events
export class MessageProtocol {
  /**
   * Serialize a message event to bytes for transmission
   */
  static serialize(event: MessageEventType): Uint8Array {
    const json: string = JSON.stringify(event);
    return new TextEncoder().encode(json);
  }

  /**
   * Deserialize bytes back to a message event
   */
  static deserialize(bytes: Uint8Array): MessageEventType {
    const json: string = new TextDecoder().decode(bytes);
    return JSON.parse(json);
  }

  /**
   * Create a text message event
   */
  static createTextMessage(text: string, options?: {
    messageType?: MessageType;
    replyTo?: string;
    mentions?: string[];
    metadata?: Record<string, unknown>;
    documentId?: string;
    documentTitle?: string;
  }): MessageEventType {
    return {
      type: 'TextMessage',
      data: {
        id: crypto.randomUUID(),
        message_type: options?.messageType || 'text',
        text,
        timestamp: Date.now(),
        replyTo: options?.replyTo,
        mentions: options?.mentions,
        metadata: options?.metadata,
        document_id: options?.documentId,
        document_title: options?.documentTitle
      }
    };
  }

  /**
   * Create a message delivered acknowledgment
   */
  static createDeliveryAck(messageId: string, userId: string): MessageEventType {
    return {
      type: 'MessageDelivered',
      data: {
        messageId,
        deliveredTo: userId,
        timestamp: Date.now()
      }
    };
  }

  /**
   * Create a message read receipt
   */
  static createReadReceipt(messageId: string, userId: string): MessageEventType {
    return {
      type: 'MessageRead',
      data: {
        messageId,
        readBy: userId,
        timestamp: Date.now()
      }
    };
  }

  /**
   * Create a typing indicator event
   */
  static createTypingIndicator(isTyping: boolean, userId: string, location: {
    nodeId?: string;
  }): MessageEventType {
    return {
      type: 'TypingIndicator',
      data: {
        isTyping,
        userId,
        location
      }
    };
  }

  /**
   * Create a user presence update
   */
  static createPresenceUpdate(
    userId: string, 
    status: 'online' | 'away' | 'busy' | 'offline',
    statusMessage?: string
  ): MessageEventType {
    return {
      type: 'UserPresence',
      data: {
        userId,
        status,
        lastSeen: Date.now(),
        statusMessage
      }
    };
  }
}