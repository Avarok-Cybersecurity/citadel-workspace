# Workspace Developer Agent

This document details how this agent is suppose to behave, first providing background context.

## Primary tool

Playwright MCP: When crafting plans or implementing features based on a query, every new feature must be validated using Playwright MCP. Frequently check the logs for errors, then add them to a file to keep track of them. Connect to the Vite default port from the citadel-workspaces app (5173).

## Layers

There are multiple layers in the communications stack:

**Base/hidden layers**
* TCP/TLS
* Citadel Protocol

**Used/visible layers**
* Internal Service Protocol (e.g., `InternalServiceRequest`/Response)
* Workspace Protocol (e.g., `WorkspaceProtocolRequest`/Response)
* Workspace Messaging Protocol (e.g., A subprotocol written inside `WorkspaceProtocolRequest::Message`. Meant for P2P communication. Uses a serialized enum to have the frontend dictate the protocol entirely via `MessageEventType`)

Depending on the desired function, as far as this project is concerned, you will use one of the visible layers

## Background

This is a tilt project that references a docker-compose.yml file with three services. The tilt file has an additional script called `sync-wasm-client` that is meant to automatically regenerate the crucial typescript bindings and wasm connector that allows the frontend to connect to the `internal-service`.

### Services

#### 1. `server`

The backend server. Is ephemeral, so if it restarts, any persisted data like user accounts are lost. When registering users in the frontend, the server address is 127.0.0.1:12349.

There are two types of passwords. The "workspace password", which is prompted when the UI asks for the server address (is empty for development), and the "workspace master password" (WMP), which is defined by the ./docker/workspace-server/kernel.toml file. The workspace password can be thought of as an "invite only" gate that ensures only clients that have the password can register to the server. The WMP, on the other hand, is used whenever an elevated permission is required at the workspace-layer of the protocol (e.g., session initialization modal is prompted to force user to initialize the workspace that way it can be used by themself and others; this only needs to be entered once. It's intended for a server setup for the first connecting usuer, typically the admin).

#### 2. `internal-service`

The `internal-service` can be considered the "bridge" between the `ui` and the `server`. This allows multiple clients from multiple LOCAL environments (e.g., multiple browser tabs, a desktop app, etc) to connect to it, allowing delegation of connection management to make frontend development easier. The frontend directly connects to it (`127.0.0.1:12345`, defined in `.env`). Its datatype is the `InternalServiceRequest` and `InternalServiceResponse`. 


#### 3. `ui`

The UI requires both the server and internal service running via tilt. It also presupposes the `sync-wasm-client` step has been run (automatically run by tilt), that way it has latest access to the rust wasm connector to connect to the `internal-service`.

The UI can make direct calls to the internal service. Several uses of it are required/used for this application:

##### ui usage of internal-service layer

Called via rust wasm function `pub async fn send_direct_to_internal_service(message: JsValue)`. This is called via a typescript function that calls this rust wasm function.

Client to server related:
* `InternalServiceRequest::Register`: Register with the `server` via the Citadel Protocol. This is the first step when "joining" a workspace. Only needs to be called once for a given user.
* `InternalServiceRequest::Connect`: Connect to the `server` via The Citadel Protocol. A connection is required for any functionality to work.

* `InternalServiceRequest::ListAllPeers`: Lists all available peers connected to the same `server`

Peer to peer related:
* `InternalServiceRequest::PeerRegister`: Register to another peer (required for connecting to the peer). Only needs to be called once for a given user_a<->user_b relationship. 
* `InternalServiceRequest::PeerConnect`: Connect to another peer. Requires peer registration prior to calling.

##### ui usage of workspace-protocol layer

`WorkspaceProtocolRequest`: used for communicating with the `server`.

The following are rust wasm functions that have corresponding typescript functions that call them directly:

`pub async fn open_p2p_connection(cid_str: String)`: used after connecting to a peer to facilitate an intersession stable messenger layer protocol.
`pub async fn send_p2p_message(cid_str: String, message: JsValue)`: Used after calling open_p2p_connection to send a WorkspaceProtocolRequest::Message to a peer.


## General workflows

### Connecting to/interacting with a peer
1. Finding their CID
2. Peer registering (if not yet registered). Done at internal service layer
3. Peer connect. Done at internal service layer
4. open_p2p_connection. Done at workspace-protocol layer
5. send_p2p_message. Done at workspace-protocol
6. Messages receieved through global event emitter