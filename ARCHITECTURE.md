# Citadel Workspace Architecture

This document provides a visual representation of the architecture of the Citadel Workspace application, showing the main components and their interactions.

## Table of Contents

1. [Tauri App Architecture](#tauri-app-architecture)
2. [Server Kernel Architecture](#server-kernel-architecture)
3. [Integration Architecture](#integration-architecture)
4. [Request and Response Flow](#request-and-response-flow)

## Tauri App Architecture

The Tauri app serves as the main interface for users, handling UI interactions and communicating with the server kernel.

```mermaid
graph TD
    subgraph "Tauri App Architecture"
        A[main.rs] --> B[lib.rs]
        B --> C[commands]
        B --> D[server_kernel_commands]
        B --> E[state.rs]
        B --> F[util]
        
        C --> C1[connect.rs]
        C --> C2[list_all_peers.rs]
        C --> C3[list_known_servers.rs]
        C --> C4[peer_connect.rs]
        C --> C5[register.rs]

        D --> D1[requests]
        D --> D2[responses]
        
        F --> F1[window_event_handler.rs]
        F --> F2[local_db.rs]
        
        E -.-> |provides state to| C
        E -.-> |provides state to| D
        
        subgraph "State Management"
            E --> E1[WorkspaceStateInner]
            E1 --> E2[messenger]
            E1 --> E3[to_subscribers]
            E1 --> E4[default_mux]
            E1 --> E5[muxes]
            E1 --> E6[window]
        end
    end
```

## Server Kernel Architecture

The server kernel handles business logic, processing commands, and managing workspace objects.

```mermaid
graph TD
    subgraph "Server Kernel Architecture"
        SK[WorkspaceServerKernel] --> CP[command_processor.rs]
        SK --> TS[transaction.rs]
        SK --> KM[mod.rs]
        
        KM --> DO[domain]
        DO --> DO1[office.rs]
        DO --> DO2[room.rs]
        DO --> DO3[member.rs]
        
        CP --> CP1[process_command]
        CP --> CP2[handle_result]
        
        subgraph "Command Processing"
            CP1 --> CP1A[Message Handling]
            CP1 --> CP1B[Office Commands]
            CP1 --> CP1C[Room Commands]
            CP1 --> CP1D[Member Commands]
            CP1 --> CP1E[Query Commands]
        end
    end
```

## Integration Architecture

This diagram shows how the Tauri app and server kernel interact.

```mermaid
graph TD
    subgraph "Tauri Application"
        TA[Tauri App] --> FR[Frontend React UI]
        TA --> RB[Rust Backend]
        
        RB --> WS[WorkspaceState]
        RB --> CM[Commands]
        RB --> SKC[Server Kernel Commands]
    end
    
    subgraph "Communication Layer"
        CWM[CitadelWorkspaceMessenger] --> MP[Multiplexer]
        CWM --> ST[Stream]
        
        MP --> MT[MessengerTx]
    end
    
    subgraph "Server Kernel"
        SK[WorkspaceServerKernel] --> CP[Command Processor]
        SK --> DP[Domain Objects]
        
        DP --> OF[Offices]
        DP --> RM[Rooms]
        DP --> MB[Members]
    end
    
    FR <--> |Tauri Commands| RB
    RB <--> |Internal Service| CWM
    CWM <--> SK
    
    WS -.-> MP
```

## Request and Response Flow

This diagram illustrates how requests and responses flow through the system.

```mermaid
sequenceDiagram
    participant Frontend as React Frontend
    participant Tauri as Tauri App
    participant State as WorkspaceState
    participant Messenger as CitadelWorkspaceMessenger
    participant Server as WorkspaceServerKernel
    
    Frontend->>Tauri: 1. invoke() command
    Tauri->>State: 2. Access state
    State->>Messenger: 3. Send workspace command
    Messenger->>Server: 4. Transmit WorkspaceProtocolRequest
    
    Server->>Server: 5. process_command()
    
    Server-->>Messenger: 6. Return WorkspaceProtocolResponse
    Messenger-->>State: 7. Deliver response
    
    alt Has Request ID
        State-->>State: 8a. Route to subscriber
    else No Request ID
        State-->>Tauri: 8b. Handle via server_kernel_commands
    end
    
    Tauri-->>Frontend: 9. Emit event to frontend
```

```mermaid
graph TD
    subgraph "Request Processing Flow"
        Req[WorkspaceProtocolRequest] --> ReqHandler[requests::handle]
        
        ReqHandler --> WS[WorkspaceState]
        ReqHandler --> EmitUI[Emit to Tauri UI]
        
        Req --> ReqTypes[Request Types]
        ReqTypes --> RT1[Message]
        ReqTypes --> RT2[CreateOffice]
        ReqTypes --> RT3[GetOffice]
        ReqTypes --> RT4[CreateRoom]
        ReqTypes --> RT5[AddMember]
        ReqTypes --> RT6[ListOffices]
        ReqTypes --> RT7[... Other Commands]
    end
    
    subgraph "Response Processing Flow"
        Res[WorkspaceProtocolResponse] --> ResHandler[responses::handle]
        
        ResHandler --> WS2[WorkspaceState]
        ResHandler --> EmitUI2[Emit to Tauri UI]
        
        Res --> ResTypes[Response Types]
        ResTypes --> RS1[Success]
        ResTypes --> RS2[Error]
        ResTypes --> RS3[Office]
        ResTypes --> RS4[Room]
        ResTypes --> RS5[Member]
        ResTypes --> RS6[Offices]
        ResTypes --> RS7[... Other Responses]
    end
```
