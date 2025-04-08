# Event System Implementation Guide

This document outlines the implementation steps for the Citadel Workspace event communication system, following the architecture defined in [EVENT_COMMUNICATION.md](./EVENT_COMMUNICATION.md).

## 1. Frontend Implementation

### 1.1 Protocol Message Creation and Serialization

First, we'll implement utility functions for creating and serializing protocol messages:

```typescript
// src/lib/workspace-protocol.ts

import { invoke } from '@tauri-apps/api/core';
import { 
  WorkspaceProtocolPayloadTS, 
  serializeWorkspacePayload,
  createMessagePayload 
} from '../types/workspace-protocol';
import { stringToUint8Array } from '../types/citadel-types';

/**
 * Sends a message to a peer through the workspace protocol
 * 
 * @param cid The connection ID of the sender
 * @param peerCid The connection ID of the recipient
 * @param message The message content as string
 * @returns A promise that resolves when the message is sent
 */
export async function sendMessage(cid: string, peerCid: string, message: string): Promise<void> {
  // Convert string message to Uint8Array
  const messageBytes = stringToUint8Array(message);
  
  // Create workspace protocol payload with message request
  const payload = createMessagePayload(messageBytes);
  
  // Serialize payload to Uint8Array
  const serializedPayload = serializeWorkspacePayload(payload);
  
  // Invoke Tauri command to send message
  await invoke('send_message', {
    cid,
    peerCid,
    message: serializedPayload
  });
}

/**
 * Sends a binary message to a peer through the workspace protocol
 * 
 * @param cid The connection ID of the sender
 * @param peerCid The connection ID of the recipient
 * @param data The binary data to send
 * @returns A promise that resolves when the message is sent
 */
export async function sendBinaryMessage(cid: string, peerCid: string, data: Uint8Array): Promise<void> {
  // Create workspace protocol payload with message request
  const payload = createMessagePayload(data);
  
  // Serialize payload to Uint8Array
  const serializedPayload = serializeWorkspacePayload(payload);
  
  // Invoke Tauri command to send message
  await invoke('send_message', {
    cid,
    peerCid,
    message: serializedPayload
  });
}
```

### 1.2 Event Processor Implementation

The Event Processor is responsible for handling all events from the backend, processing them, and updating the UI state:

```typescript
// src/lib/event-processor.ts

import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';

// Import workspace types
import { OfficeTS, RoomTS, UserTS } from '../types/workspace-types';

// Define state types
interface ConnectionState {
  connected: boolean;
  cid: string | null;
  error: string | null;
}

interface PeerState {
  peers: Record<string, UserTS>;
  activePeer: string | null;
}

interface MessageState {
  messages: Record<string, Message[]>; // peerCid -> messages
}

interface Message {
  id: string;
  peerCid: string;
  content: Uint8Array;
  timestamp: number;
  fromSelf: boolean;
}

interface WorkspaceState {
  offices: OfficeTS[];
  rooms: Record<string, RoomTS[]>; // officeId -> rooms
  members: Record<string, UserTS[]>; // roomId or officeId -> members
  currentOffice: string | null;
  currentRoom: string | null;
}

// Combined application state
interface AppState {
  connection: ConnectionState;
  peers: PeerState;
  messages: MessageState;
  workspace: WorkspaceState;
  
  // Actions
  setConnected: (connected: boolean, cid?: string) => void;
  setConnectionError: (error: string | null) => void;
  updatePeers: (peers: UserTS[]) => void;
  setActivePeer: (peerCid: string | null) => void;
  addMessage: (message: Message) => void;
  updateOffices: (offices: OfficeTS[]) => void;
  updateRooms: (officeId: string, rooms: RoomTS[]) => void;
  updateMembers: (domainId: string, members: UserTS[]) => void;
  setCurrentOffice: (officeId: string | null) => void;
  setCurrentRoom: (roomId: string | null) => void;
}

// Create global state store
export const useAppStore = create<AppState>((set) => ({
  // Initial state
  connection: {
    connected: false,
    cid: null,
    error: null,
  },
  peers: {
    peers: {},
    activePeer: null,
  },
  messages: {
    messages: {},
  },
  workspace: {
    offices: [],
    rooms: {},
    members: {},
    currentOffice: null,
    currentRoom: null,
  },
  
  // Actions
  setConnected: (connected, cid) => set((state) => ({
    connection: {
      ...state.connection,
      connected,
      cid: cid || state.connection.cid,
      error: connected ? null : state.connection.error,
    }
  })),
  
  setConnectionError: (error) => set((state) => ({
    connection: {
      ...state.connection,
      error,
    }
  })),
  
  updatePeers: (peers) => set((state) => {
    const peersMap = { ...state.peers.peers };
    peers.forEach(peer => {
      peersMap[peer.id] = peer;
    });
    
    return {
      peers: {
        ...state.peers,
        peers: peersMap,
      }
    };
  }),
  
  setActivePeer: (peerCid) => set((state) => ({
    peers: {
      ...state.peers,
      activePeer: peerCid,
    }
  })),
  
  addMessage: (message) => set((state) => {
    const existingMessages = state.messages.messages[message.peerCid] || [];
    
    return {
      messages: {
        ...state.messages,
        messages: {
          ...state.messages.messages,
          [message.peerCid]: [...existingMessages, message],
        }
      }
    };
  }),
  
  updateOffices: (offices) => set((state) => ({
    workspace: {
      ...state.workspace,
      offices,
    }
  })),
  
  updateRooms: (officeId, rooms) => set((state) => ({
    workspace: {
      ...state.workspace,
      rooms: {
        ...state.workspace.rooms,
        [officeId]: rooms,
      }
    }
  })),
  
  updateMembers: (domainId, members) => set((state) => ({
    workspace: {
      ...state.workspace,
      members: {
        ...state.workspace.members,
        [domainId]: members,
      }
    }
  })),
  
  setCurrentOffice: (officeId) => set((state) => ({
    workspace: {
      ...state.workspace,
      currentOffice: officeId,
    }
  })),
  
  setCurrentRoom: (roomId) => set((state) => ({
    workspace: {
      ...state.workspace,
      currentRoom: roomId,
    }
  })),
}));

// Event processor class
export class EventProcessor {
  private static instance: EventProcessor;
  private unlisteners: (() => void)[] = [];
  
  private constructor() {
    // Private constructor for singleton pattern
  }
  
  // Get EventProcessor instance
  public static getInstance(): EventProcessor {
    if (!EventProcessor.instance) {
      EventProcessor.instance = new EventProcessor();
    }
    return EventProcessor.instance;
  }
  
  // Initialize event listeners
  public async initialize(): Promise<void> {
    // Clean up any existing listeners
    await this.cleanup();
    
    // Set up listeners for all event types
    this.unlisteners = await Promise.all([
      this.setupConnectionListeners(),
      this.setupPeerListeners(),
      this.setupMessageListeners(),
      this.setupWorkspaceListeners(),
      this.setupErrorListeners(),
    ]);
    
    console.log('Event processor initialized with all listeners');
  }
  
  // Clean up all listeners
  public async cleanup(): Promise<void> {
    for (const unlisten of this.unlisteners) {
      unlisten();
    }
    this.unlisteners = [];
    console.log('Event processor cleaned up all listeners');
  }
  
  // Set up connection event listeners
  private async setupConnectionListeners(): Promise<() => void> {
    const connectionStatusUnlisten = await listen('connection-status-changed', (event) => {
      const { connected, cid } = event.payload as { connected: boolean, cid?: string };
      useAppStore.getState().setConnected(connected, cid);
    });
    
    return () => connectionStatusUnlisten();
  }
  
  // Set up peer event listeners
  private async setupPeerListeners(): Promise<() => void> {
    const peerStatusUnlisten = await listen('peer-online', (event) => {
      const { peer } = event.payload as { peer: UserTS };
      useAppStore.getState().updatePeers([peer]);
    });
    
    const peerOfflineUnlisten = await listen('peer-offline', (event) => {
      const { peer_cid } = event.payload as { peer_cid: string };
      const peerState = useAppStore.getState().peers;
      
      if (peerState.peers[peer_cid]) {
        const updatedPeer = {
          ...peerState.peers[peer_cid],
          online: false
        };
        
        useAppStore.getState().updatePeers([updatedPeer]);
      }
    });
    
    return () => {
      peerStatusUnlisten();
      peerOfflineUnlisten();
    };
  }
  
  // Set up message event listeners
  private async setupMessageListeners(): Promise<() => void> {
    const messageReceivedUnlisten = await listen('message:received', (event) => {
      const { connection, contents } = event.payload as { 
        connection: { cid: string, peer_cid: string, request_id?: string },
        contents: string
      };
      
      // Decode contents from base64 if necessary or parse as needed
      let contentBytes: Uint8Array;
      try {
        // Attempt to parse as string first
        contentBytes = new TextEncoder().encode(contents);
      } catch (error) {
        console.error('Failed to process message contents:', error);
        return;
      }
      
      const message: Message = {
        id: connection.request_id || crypto.randomUUID(),
        peerCid: connection.peer_cid,
        content: contentBytes,
        timestamp: Date.now(),
        fromSelf: false
      };
      
      useAppStore.getState().addMessage(message);
    });
    
    return () => messageReceivedUnlisten();
  }
  
  // Set up workspace event listeners
  private async setupWorkspaceListeners(): Promise<() => void> {
    const officeLoadedUnlisten = await listen('office:loaded', (event) => {
      const { office, connection } = event.payload as { 
        office: OfficeTS,
        connection: { cid: string, peer_cid?: string, request_id?: string }
      };
      
      useAppStore.getState().updateOffices([office]);
    });
    
    const officesLoadedUnlisten = await listen('offices:loaded', (event) => {
      const { offices, connection } = event.payload as { 
        offices: OfficeTS[],
        connection: { cid: string, peer_cid?: string, request_id?: string }
      };
      
      useAppStore.getState().updateOffices(offices);
    });
    
    const roomLoadedUnlisten = await listen('room:loaded', (event) => {
      const { room, connection } = event.payload as { 
        room: RoomTS,
        connection: { cid: string, peer_cid?: string, request_id?: string }
      };
      
      const officeId = room.office_id;
      const existingRooms = useAppStore.getState().workspace.rooms[officeId] || [];
      
      // Replace room if it exists, otherwise add it
      const updatedRooms = existingRooms.map(r => 
        r.id === room.id ? room : r
      );
      
      if (!updatedRooms.some(r => r.id === room.id)) {
        updatedRooms.push(room);
      }
      
      useAppStore.getState().updateRooms(officeId, updatedRooms);
    });
    
    const roomsLoadedUnlisten = await listen('rooms:loaded', (event) => {
      const { rooms, connection } = event.payload as { 
        rooms: RoomTS[],
        connection: { cid: string, peer_cid?: string, request_id?: string }
      };
      
      // Group rooms by office ID
      const roomsByOffice: Record<string, RoomTS[]> = {};
      
      rooms.forEach(room => {
        const officeId = room.office_id;
        if (!roomsByOffice[officeId]) {
          roomsByOffice[officeId] = [];
        }
        roomsByOffice[officeId].push(room);
      });
      
      // Update rooms for each office
      Object.entries(roomsByOffice).forEach(([officeId, officeRooms]) => {
        useAppStore.getState().updateRooms(officeId, officeRooms);
      });
    });
    
    const membersLoadedUnlisten = await listen('members:loaded', (event) => {
      const { members, domain_id, connection } = event.payload as { 
        members: UserTS[],
        domain_id: string, // office_id or room_id
        connection: { cid: string, peer_cid?: string, request_id?: string }
      };
      
      useAppStore.getState().updateMembers(domain_id, members);
    });
    
    return () => {
      officeLoadedUnlisten();
      officesLoadedUnlisten();
      roomLoadedUnlisten();
      roomsLoadedUnlisten();
      membersLoadedUnlisten();
    };
  }
  
  // Set up error event listeners
  private async setupErrorListeners(): Promise<() => void> {
    const operationErrorUnlisten = await listen('operation:error', (event) => {
      const { message, connection } = event.payload as { 
        message: string,
        connection: { cid: string, peer_cid?: string, request_id?: string }
      };
      
      useAppStore.getState().setConnectionError(message);
      
      // Show error toast or notification here
      console.error(`Operation error: ${message}`);
    });
    
    const protocolWarningUnlisten = await listen('protocol:warning', (event) => {
      const { message, connection } = event.payload as { 
        message: string,
        connection: { cid: string, peer_cid?: string, request_id?: string }
      };
      
      // Log warning but don't update error state
      console.warn(`Protocol warning: ${message}`);
    });
    
    return () => {
      operationErrorUnlisten();
      protocolWarningUnlisten();
    };
  }
}

// Export singleton instance
export const eventProcessor = EventProcessor.getInstance();
```

### 1.3 Event Initialization and React Integration

To initialize the event system and integrate it with React:

```typescript
// src/lib/event-hooks.ts

import { useEffect } from 'react';
import { eventProcessor, useAppStore } from './event-processor';

/**
 * Hook to initialize the event processor when the app starts
 */
export function useEventProcessor(): void {
  useEffect(() => {
    const initialize = async () => {
      await eventProcessor.initialize();
    };
    
    initialize().catch(console.error);
    
    // Clean up on component unmount
    return () => {
      eventProcessor.cleanup().catch(console.error);
    };
  }, []);
}

/**
 * Hook to access connection state
 */
export function useConnection() {
  return useAppStore(state => state.connection);
}

/**
 * Hook to access peer state
 */
export function usePeers() {
  return useAppStore(state => state.peers);
}

/**
 * Hook to access messages
 */
export function useMessages(peerCid?: string) {
  const messages = useAppStore(state => state.messages.messages);
  
  if (peerCid) {
    return messages[peerCid] || [];
  }
  
  return messages;
}

/**
 * Hook to access workspace state
 */
export function useWorkspace() {
  return useAppStore(state => state.workspace);
}
```

## 2. Backend Implementation

The backend implementation is largely in place, but we'll make a few enhancements to ensure proper event emission:

### 2.1 Enhanced Event Emission in Rust

In the Rust backend, we need to ensure that all response types emit the appropriate events:

```rust
// Example of enhanced event emission in src-tauri/src/server_kernel_commands/responses/mod.rs

// For workspace responses
match response {
    WorkspaceProtocolResponse::Office(office) => {
        // Combine office data with connection info
        let payload = json!({
            "office": office,
            "connection": connection_info
        });

        // Emit event to frontend with the combined data
        state
            .window
            .get()
            .expect("unset")
            .emit("office:loaded", payload)
            .map_err(|e| Box::new(e) as Box<dyn Error>)?;
    }
    
    // Other response types handled similarly...
}
```

### A. Message Request Handling

```rust
// Example of Message request handling in src-tauri/src/server_kernel_commands/requests/mod.rs

if let WorkspaceProtocolRequest::Message { contents } = request {
    // Create payload to send to frontend
    let payload = json!({
        "connection": connection_info,
        "contents": String::from_utf8(contents)?,
    });
        
    // Emit event to front-end to show we received a message
    state
        .window
        .get()
        .expect("unset")
        .emit("message:received", payload)
        .map_err(|e| Box::new(e) as Box<dyn Error>)?;
}
```

## 3. Integration and Usage

### 3.1 App Component with Event Initialization

```tsx
// src/App.tsx

import { useEventProcessor } from './lib/event-hooks';

function App() {
  // Initialize event processor
  useEventProcessor();
  
  return (
    <div className="app">
      {/* Other components */}
    </div>
  );
}

export default App;
```

### 3.2 Example Chat Component

```tsx
// src/components/Chat.tsx

import { useState } from 'react';
import { useConnection, usePeers, useMessages } from '../lib/event-hooks';
import { sendMessage } from '../lib/workspace-protocol';

function Chat() {
  const [messageInput, setMessageInput] = useState('');
  const connection = useConnection();
  const { peers, activePeer } = usePeers();
  const messages = useMessages(activePeer || undefined);
  
  const handleSendMessage = async () => {
    if (!connection.connected || !connection.cid || !activePeer || !messageInput.trim()) {
      return;
    }
    
    try {
      await sendMessage(connection.cid, activePeer, messageInput);
      setMessageInput('');
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };
  
  return (
    <div className="chat">
      <div className="messages">
        {messages.map(message => (
          <div 
            key={message.id} 
            className={`message ${message.fromSelf ? 'sent' : 'received'}`}
          >
            <div className="content">
              {new TextDecoder().decode(message.content)}
            </div>
            <div className="timestamp">
              {new Date(message.timestamp).toLocaleTimeString()}
            </div>
          </div>
        ))}
      </div>
      
      <div className="input-area">
        <input
          type="text"
          value={messageInput}
          onChange={(e) => setMessageInput(e.target.value)}
          placeholder="Type a message..."
        />
        <button onClick={handleSendMessage}>Send</button>
      </div>
    </div>
  );
}

export default Chat;
```

## 4. Testing the Implementation

### 4.1 Message Protocol Tests

```typescript
// src/tests/workspace-protocol.test.ts

import { describe, it, expect } from 'vitest';
import { 
  createMessagePayload, 
  serializeWorkspacePayload, 
  deserializeWorkspacePayload 
} from '../types/workspace-protocol';

describe('Workspace Protocol', () => {
  it('should create a message payload correctly', () => {
    const testData = new Uint8Array([1, 2, 3, 4, 5]);
    const payload = createMessagePayload(testData);
    
    expect(payload).toHaveProperty('request');
    expect(payload.request).toHaveProperty('message');
    expect(payload.request?.message).toHaveProperty('contents');
    expect(payload.request?.message?.contents).toEqual(testData);
  });
  
  it('should serialize and deserialize payloads correctly', () => {
    const testData = new Uint8Array([1, 2, 3, 4, 5]);
    const payload = createMessagePayload(testData);
    
    const serialized = serializeWorkspacePayload(payload);
    const deserialized = deserializeWorkspacePayload(serialized);
    
    expect(deserialized).toHaveProperty('request');
    expect(deserialized.request).toHaveProperty('message');
    expect(deserialized.request?.message).toHaveProperty('contents');
    
    // Arrays are serialized to base64 in JSON and deserialized as regular arrays
    expect(Array.from(deserialized.request?.message?.contents as unknown as number[])).toEqual([1, 2, 3, 4, 5]);
  });
});
```

### 4.2 Event Processor Tests

```typescript
// src/tests/event-processor.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAppStore, EventProcessor } from '../lib/event-processor';

// Mock Tauri's listen function
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockImplementation((event, callback) => {
    // Store the callback for testing
    (global as any).eventCallbacks = (global as any).eventCallbacks || {};
    (global as any).eventCallbacks[event] = callback;
    
    return Promise.resolve(() => {
      // Unlisten function
      delete (global as any).eventCallbacks[event];
    });
  })
}));

describe('Event Processor', () => {
  beforeEach(() => {
    // Reset the store before each test
    useAppStore.setState({
      connection: { connected: false, cid: null, error: null },
      peers: { peers: {}, activePeer: null },
      messages: { messages: {} },
      workspace: { 
        offices: [], 
        rooms: {}, 
        members: {}, 
        currentOffice: null, 
        currentRoom: null 
      },
      
      // Actions
      setConnected: vi.fn(),
      setConnectionError: vi.fn(),
      updatePeers: vi.fn(),
      setActivePeer: vi.fn(),
      addMessage: vi.fn(),
      updateOffices: vi.fn(),
      updateRooms: vi.fn(),
      updateMembers: vi.fn(),
      setCurrentOffice: vi.fn(),
      setCurrentRoom: vi.fn(),
    });
    
    // Reset event callbacks
    (global as any).eventCallbacks = {};
  });
  
  afterEach(() => {
    vi.clearAllMocks();
  });
  
  it('should initialize event listeners', async () => {
    const eventProcessor = EventProcessor.getInstance();
    await eventProcessor.initialize();
    
    // Check if listeners were set up for all expected events
    const expectedEvents = [
      'connection-status-changed',
      'peer-online',
      'peer-offline',
      'message:received',
      'office:loaded',
      'offices:loaded',
      'room:loaded',
      'rooms:loaded',
      'members:loaded',
      'operation:error',
      'protocol:warning'
    ];
    
    expectedEvents.forEach(event => {
      expect((global as any).eventCallbacks).toHaveProperty(event);
    });
  });
  
  it('should process connection status events', async () => {
    const eventProcessor = EventProcessor.getInstance();
    await eventProcessor.initialize();
    
    const setConnected = vi.spyOn(useAppStore.getState(), 'setConnected');
    
    // Simulate a connection event
    const callback = (global as any).eventCallbacks['connection-status-changed'];
    callback({ payload: { connected: true, cid: '12345' } });
    
    expect(setConnected).toHaveBeenCalledWith(true, '12345');
  });
  
  it('should process message received events', async () => {
    const eventProcessor = EventProcessor.getInstance();
    await eventProcessor.initialize();
    
    const addMessage = vi.spyOn(useAppStore.getState(), 'addMessage');
    
    // Simulate a message received event
    const callback = (global as any).eventCallbacks['message:received'];
    callback({ 
      payload: { 
        connection: { 
          cid: '12345', 
          peer_cid: '67890', 
          request_id: 'abcdef' 
        }, 
        contents: 'Hello, world!' 
      } 
    });
    
    expect(addMessage).toHaveBeenCalled();
    const message = addMessage.mock.calls[0][0];
    expect(message.id).toBe('abcdef');
    expect(message.peerCid).toBe('67890');
    expect(new TextDecoder().decode(message.content)).toBe('Hello, world!');
    expect(message.fromSelf).toBe(false);
  });
});

## 5. Implementation Steps

To implement this system, follow these steps:

1. **Create Type Definitions**: 
   - Ensure workspace protocol types are defined in TypeScript (already done) 
   - Define state types for the application 

2. **Implement Core Utilities**: 
   - Create workspace-protocol.ts with serialization functions 
   - Implement the global store with Zustand 
   - Create the EventProcessor class 

3. **Integrate with UI**: 
   - Add event hooks for React components 
   - Create the EventSystemDemo component 
   - Initialize the EventProcessor in UI components 

4. **Test the Implementation**:
   - Write unit tests for the protocol serialization
   - Test event processing with mock events
   - Implement end-to-end tests for full flow

5. **Optimize and Refine**:
   - Add error handling and recovery mechanisms
   - Optimize state updates for performance
   - Add logging for diagnostics

This implementation follows the best practices for React development, maintains clean code separation, and ensures type safety throughout the application.

### Implementation Steps Checklist

1. **Create Type Definitions**: 
   - Ensure workspace protocol types are defined in TypeScript 
   - Define state types for the application 

2. **Implement Core Utilities**: 
   - Create workspace-protocol.ts with serialization functions 
   - Implement the global store with Zustand 
   - Create the EventProcessor class 

3. **Integrate with UI**: 
   - Add event hooks for React components 
   - Create the EventSystemDemo component 
   - Initialize the EventProcessor in UI components 

4. **Test the Implementation**:
   - Write unit tests for the protocol serialization
   - Test event processing with mock events
   - Implement end-to-end tests for full flow

5. **Optimize and Refine**:
   - Add error handling and recovery mechanisms
   - Optimize state updates for performance
   - Add logging for diagnostics

### Completed Tasks

1. **Create Type Definitions**: 
   - Ensure workspace protocol types are defined in TypeScript 
   - Define state types for the application 

2. **Implement Core Utilities**: 
   - Create workspace-protocol.ts with serialization functions 
   - Implement the global store with Zustand 
   - Create the EventProcessor class 

3. **Integrate with UI**: 
   - Add event hooks for React components 
   - Create the EventSystemDemo component 
   - Initialize the EventProcessor in UI components 

4. **Test the Implementation**:
   - Write unit tests for the protocol serialization
   - Test event processing with mock events
   - Implement end-to-end tests for full flow

5. **Optimize and Refine**:
   - Add error handling and recovery mechanisms
   - Optimize state updates for performance
   - Add logging for diagnostics
