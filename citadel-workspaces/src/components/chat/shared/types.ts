/**
 * Shared chat types used across P2P and Group chat components
 */

/** Base message interface with common fields */
export interface BaseChatMessage {
  id: string;
  content: string;
  timestamp: number;
  sender_id: string;
  sender_name: string;
}

/** Message status for delivery tracking */
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

/** Presence status options */
export type PresenceStatus = 'online' | 'away' | 'offline' | 'custom';

/** Status display configuration */
export interface StatusDisplay {
  text: string;
  color: string;
  textColor: string;
  customColor?: string;
}

/** Chat input state */
export interface ChatInputState {
  value: string;
  sending: boolean;
  disabled: boolean;
  placeholder?: string;
}

/** Loading states for chat components */
export interface ChatLoadingState {
  initial: boolean;
  more: boolean;
  sending: boolean;
}
