/**
 * P2P Test Utilities
 *
 * This module provides helpers for P2P testing:
 * - Registration: p2pRegister, acceptP2PRequest, verifyConnectedBadgeInModal
 * - Conversation: openConversation
 * - Connection: connectP2P, disconnectP2P
 * - Session: disconnect/reconnect via various UI flows
 */

// Re-export all from submodules for backwards compatibility
export * from './registration.js';
export * from './conversation.js';
export * from './connection.js';
export * from './session.js';
