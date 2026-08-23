# Citadel Internal Service Data Structures

This document outlines the key data structures used in the Citadel Workspace application for communication between the Rust backend and TypeScript frontend. Proper type synchronization between these layers is critical for application functionality.

## Core Response Types

These are the primary response types that the backend can send to the frontend.

### Connection Responses

| Rust Type | Fields | Description |
|-----------|--------|-------------|
| `ConnectSuccess` | `cid: u64`, `request_id: Option<Uuid>` | Successful connection to a workspace |
| `ConnectFailure` | `cid: u64`, `message: String`, `request_id: Option<Uuid>` | Failed connection attempt |
| `RegisterSuccess` | `cid: u64`, `request_id: Option<Uuid>` | Successful registration with a workspace |
| `RegisterFailure` | `cid: u64`, `message: String`, `request_id: Option<Uuid>` | Failed registration attempt |
| `ServiceConnectionAccepted` | `cid: u64`, `request_id: Option<Uuid>` | Service connection was accepted |

### Message-Related Responses

| Rust Type | Fields | Description |
|-----------|--------|-------------|
| `MessageSendSuccess` | `cid: u64`, `peer_cid: Option<u64>`, `request_id: Option<Uuid>` | Message was sent successfully |
| `MessageSendFailure` | `cid: u64`, `message: String`, `request_id: Option<Uuid>` | Message failed to send |
| `MessageNotification` | `message: BytesMut`, `cid: u64`, `peer_cid: u64`, `request_id: Option<Uuid>` | Incoming message notification |

### Disconnect Responses

| Rust Type | Fields | Description |
|-----------|--------|-------------|
| `DisconnectNotification` | `cid: u64`, `peer_cid: Option<u64>`, `request_id: Option<Uuid>` | Notification of disconnection |
| `DisconnectFailure` | `cid: u64`, `message: String`, `request_id: Option<Uuid>` | Failed to disconnect |

### Peer Connection Responses

| Rust Type | Fields | Description |
|-----------|--------|-------------|
| `PeerConnectSuccess` | `cid: u64`, `peer_cid: u64`, `request_id: Option<Uuid>` | Successfully connected to peer |
| `PeerConnectFailure` | `cid: u64`, `message: String`, `request_id: Option<Uuid>` | Failed to connect to peer |
| `PeerDisconnectSuccess` | `cid: u64`, `request_id: Option<Uuid>` | Successfully disconnected from peer |
| `PeerDisconnectFailure` | `cid: u64`, `message: String`, `request_id: Option<Uuid>` | Failed to disconnect from peer |
| `PeerConnectNotification` | `cid: u64`, `peer_cid: u64`, `session_security_settings: SessionSecuritySettings`, `udp_mode: UdpMode`, `request_id: Option<Uuid>` | Notification of peer connection |
| `PeerRegisterNotification` | `cid: u64`, `peer_cid: u64`, `peer_username: String`, `request_id: Option<Uuid>` | Notification of peer registration |
| `PeerRegisterSuccess` | `cid: u64`, `peer_cid: u64`, `peer_username: String`, `request_id: Option<Uuid>` | Successfully registered with peer |
| `PeerRegisterFailure` | `cid: u64`, `message: String`, `request_id: Option<Uuid>` | Failed to register with peer |

### Database Operations Responses

| Rust Type | Fields | Description |
|-----------|--------|-------------|
| `LocalDBGetKVSuccess` | `cid: u64`, `peer_cid: Option<u64>`, `key: String`, `value: Vec<u8>`, `request_id: Option<Uuid>` | Successfully retrieved key-value pair |
| `LocalDBGetKVFailure` | `cid: u64`, `peer_cid: Option<u64>`, `message: String`, `request_id: Option<Uuid>` | Failed to retrieve key-value pair |
| `LocalDBSetKVSuccess` | `cid: u64`, `peer_cid: Option<u64>`, `key: String`, `request_id: Option<Uuid>` | Successfully set key-value pair |
| `LocalDBSetKVFailure` | `cid: u64`, `peer_cid: Option<u64>`, `message: String`, `request_id: Option<Uuid>` | Failed to set key-value pair |
| `LocalDBDeleteKVSuccess` | `cid: u64`, `peer_cid: Option<u64>`, `key: String`, `request_id: Option<Uuid>` | Successfully deleted key-value pair |
| `LocalDBDeleteKVFailure` | `cid: u64`, `peer_cid: Option<u64>`, `message: String`, `request_id: Option<Uuid>` | Failed to delete key-value pair |
| `LocalDBGetAllKVSuccess` | `cid: u64`, `peer_cid: Option<u64>`, `map: HashMap<String, Vec<u8>>`, `request_id: Option<Uuid>` | Successfully retrieved all key-value pairs |
| `LocalDBGetAllKVFailure` | `cid: u64`, `peer_cid: Option<u64>`, `message: String`, `request_id: Option<Uuid>` | Failed to retrieve all key-value pairs |
| `LocalDBClearAllKVSuccess` | `cid: u64`, `peer_cid: Option<u64>`, `request_id: Option<Uuid>` | Successfully cleared all key-value pairs |
| `LocalDBClearAllKVFailure` | `cid: u64`, `peer_cid: Option<u64>`, `message: String`, `request_id: Option<Uuid>` | Failed to clear all key-value pairs |

### Peer Information Responses

| Rust Type | Fields | Description |
|-----------|--------|-------------|
| `ListAllPeersResponse` | `cid: u64`, `peer_information: HashMap<u64, PeerInformation>`, `request_id: Option<Uuid>` | List of all available peers |
| `ListAllPeersFailure` | `cid: u64`, `message: String`, `request_id: Option<Uuid>` | Failed to list peers |
| `ListRegisteredPeersResponse` | `cid: u64`, `peers: HashMap<u64, PeerInformation>`, `request_id: Option<Uuid>` | List of all registered peers |
| `ListRegisteredPeersFailure` | `cid: u64`, `message: String`, `request_id: Option<Uuid>` | Failed to list registered peers |
| `PeerInformation` | `cid: u64`, `online_status: bool`, `name: Option<String>`, `username: Option<String>` | Information about a peer |

## Core Request Types

These are the primary request types that the frontend can send to the backend.

### Connection Requests

| Rust Type | Fields | Description |
|-----------|--------|-------------|
| `Connect` | `request_id: Uuid`, `username: String`, `password: SecBuffer`, `connect_mode: ConnectMode`, `udp_mode: UdpMode`, `keep_alive_timeout: Option<Duration>`, `session_security_settings: SessionSecuritySettings`, `server_password: Option<PreSharedKey>` | Request to connect to a workspace |
| `Register` | `request_id: Uuid`, `server_addr: SocketAddr`, `full_name: String`, `username: String`, `proposed_password: SecBuffer`, `connect_after_register: bool`, `session_security_settings: SessionSecuritySettings`, `server_password: Option<PreSharedKey>` | Request to register with a workspace |
| `Disconnect` | `request_id: Uuid`, `cid: u64` | Request to disconnect from a workspace |

### Peer Operation Requests

| Rust Type | Fields | Description |
|-----------|--------|-------------|
| `ListAllPeers` | `request_id: Uuid`, `cid: u64` | Request to list all available peers |
| `ListRegisteredPeers` | `request_id: Uuid`, `cid: u64` | Request to list all registered peers |
| `PeerConnect` | `request_id: Uuid`, `cid: u64`, `peer_cid: u64`, `udp_mode: UdpMode`, `session_security_settings: SessionSecuritySettings`, `peer_session_password: Option<PreSharedKey>` | Request to connect to a peer |
| `PeerDisconnect` | `request_id: Uuid`, `cid: u64`, `peer_cid: u64` | Request to disconnect from a peer |
| `PeerRegister` | `request_id: Uuid`, `cid: u64`, `peer_cid: u64`, `session_security_settings: SessionSecuritySettings`, `connect_after_register: bool`, `peer_session_password: Option<PreSharedKey>` | Request to register with a peer |

### Message Requests

| Rust Type | Fields | Description |
|-----------|--------|-------------|
| `Message` | `request_id: Uuid`, `message: Vec<u8>`, `cid: u64`, `peer_cid: Option<u64>`, `security_level: SecurityLevel` | Request to send a message |

### Database Operation Requests

| Rust Type | Fields | Description |
|-----------|--------|-------------|
| `LocalDBGetKV` | `request_id: Uuid`, `cid: u64`, `peer_cid: Option<u64>`, `key: String` | Request to get a key-value pair |
| `LocalDBSetKV` | `request_id: Uuid`, `cid: u64`, `peer_cid: Option<u64>`, `key: String`, `value: Vec<u8>` | Request to set a key-value pair |
| `LocalDBDeleteKV` | `request_id: Uuid`, `cid: u64`, `peer_cid: Option<u64>`, `key: String` | Request to delete a key-value pair |
| `LocalDBGetAllKV` | `request_id: Uuid`, `cid: u64`, `peer_cid: Option<u64>` | Request to get all key-value pairs |
| `LocalDBClearAllKV` | `request_id: Uuid`, `cid: u64`, `peer_cid: Option<u64>` | Request to clear all key-value pairs |

## Type Mappings (Rust to TypeScript)

| Rust Type | TypeScript Type | Notes |
|-----------|----------------|-------|
| `u64` | `string` | JavaScript doesn't support 64-bit integers natively, so we use strings |
| `Uuid` | `string` | Represented as a string in TypeScript |
| `Option<T>` | `T \| undefined` | Nullable values |
| `Vec<u8>` | `Uint8Array` | Binary data |
| `SecBuffer` | `Uint8Array` | Secure binary data |
| `HashMap<K, V>` | `Record<K, V>` | Key-value mappings |
| `BytesMut` | `Uint8Array` | Mutable binary data |
| `SocketAddr` | `string` | Socket address as string (e.g., "127.0.0.1:8080") |
| `Duration` | `number` | Duration in milliseconds |
| `PathBuf` | `string` | File path as string |

## TypeScript Interface Examples

Here are some examples of how to represent Rust types in TypeScript:

```typescript
// Connect Request
export interface ConnectRequestTS {
  request_id: string; // UUID as string
  username: string;
  password: Uint8Array; // SecBuffer
  connect_mode: ConnectMode;
  udp_mode: UdpMode;
  keep_alive_timeout?: number; // Option<Duration>
  session_security_settings: SessionSecuritySettings;
  server_password?: Uint8Array; // Option<PreSharedKey>
}

// Connect Response
export interface ConnectResponseTS {
  cid?: string; // Option<u64> as string
  success: boolean;
  message: string;
}

// Registration Request
export interface RegistrationRequestTS {
  request_id: string; // UUID as string
  server_addr: string; // SocketAddr as string
  full_name: string;
  username: string;
  proposed_password: Uint8Array; // SecBuffer
  connect_after_register: boolean;
  session_security_settings: SessionSecuritySettings;
  server_password?: Uint8Array; // Option<PreSharedKey>
}

// Registration Response
export interface RegistrationResponseTS {
  success: boolean;
  message: string;
}

// Peer Information
export interface PeerInformationTS {
  cid: string; // u64 as string
  online_status: boolean;
  name?: string;
  username?: string;
}

// ListAllPeers Response
export interface ListAllPeersResponseTS {
  cid: string; // u64 as string
  peer_information: Record<string, PeerInformationTS>; // HashMap<u64, PeerInformation>
  success: boolean;
  message: string;
}
```

## Best Practices for Type Synchronization

1. **Always convert u64 to string**: JavaScript can't handle 64-bit integers natively, so always convert them to strings.
2. **Use explicit type conversions**: Don't rely on implicit conversions between Rust and TypeScript.
3. **Validate inputs**: Always validate inputs on both the frontend and backend.
4. **Keep types in sync**: When changing a type in Rust, make sure to update the corresponding TypeScript interface.
5. **Document type mappings**: Always document how Rust types map to TypeScript types.
6. **Use strict typing**: Enable strict type checking in TypeScript to catch type errors early.
7. **Test serialization/deserialization**: Test that data can be properly serialized and deserialized between Rust and TypeScript.
