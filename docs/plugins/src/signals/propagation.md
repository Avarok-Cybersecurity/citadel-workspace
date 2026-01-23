# Hierarchical Signal Propagation

## Signal System Overview

The signal system enables event-driven communication across the domain hierarchy. This is critical for:
- **Incident escalation** (Room → Office → Workspace)
- **Command delegation** (Workspace → Office → Room)
- **Cross-domain coordination** (Sibling offices/rooms)
- **Audit trails** (All signals logged)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SIGNAL PROPAGATION FLOW                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   UPWARD (Escalation)              DOWNWARD (Delegation)                    │
│                                                                             │
│   ┌──────────────┐                 ┌──────────────┐                         │
│   │  Workspace   │ ◄───────────── │  Workspace   │                         │
│   │   Admin      │    Escalated   │   Admin      │                         │
│   └──────┬───────┘    Signal      └──────┬───────┘                         │
│          │                               │                                  │
│   ┌──────┴───────┐    Queued      ┌──────▼───────┐    Command              │
│   │   Office A   │ ◄─ for ─────── │   Office A   │                         │
│   │   Manager    │   Review       │   Manager    │                         │
│   └──────┬───────┘                └──────┬───────┘                         │
│          │                               │                                  │
│   ┌──────┴───────┐    Signal      ┌──────▼───────┐    Delegated            │
│   │   Room A1    │ ◄─ Origin ──── │   Room A1    │ ◄─ Task                 │
│   │   (Issue!)   │                │   (Execute)  │                         │
│   └──────────────┘                └──────────────┘                         │
│                                                                             │
│   SIBLING (Coordination)           BROADCAST (Announcement)                 │
│                                                                             │
│   ┌──────────────┐                 ┌──────────────┐                         │
│   │   Office A   │ ◄───────────── │  Workspace   │ ────► All Domains       │
│   └──────────────┘    Sibling     └──────────────┘                         │
│          │            Signal                                                │
│   ┌──────▼───────┐                                                          │
│   │   Office B   │                                                          │
│   └──────────────┘                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Signal Definition

```rust
/// Signal structure for hierarchical propagation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signal {
    /// Unique signal identifier
    pub id: Uuid,

    /// Signal type (namespaced, e.g., "plugin.ide.compile-error")
    pub signal_type: String,

    /// Origin domain
    pub origin: DomainPath,

    /// Current domain (changes as signal propagates)
    pub current: DomainPath,

    /// Signal payload (arbitrary JSON)
    pub payload: serde_json::Value,

    /// Signal metadata
    pub metadata: SignalMetadata,

    /// Propagation history
    pub history: Vec<PropagationEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalMetadata {
    pub created_at: i64,
    pub created_by: UserId,
    pub priority: SignalPriority,
    pub ttl: Option<i64>,  // Time-to-live in ms
    pub requires_ack: bool,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum SignalPriority {
    Low,
    Normal,
    High,
    Critical,  // Bypasses queues, immediate delivery
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropagationEntry {
    pub domain: DomainPath,
    pub action: PropagationAction,
    pub timestamp: i64,
    pub actor: Option<UserId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PropagationAction {
    Received,
    Queued,
    Acknowledged,
    Escalated { reason: String },
    Delegated { assignee: UserId },
    Completed { result: serde_json::Value },
    Dropped { reason: String },
}
```

## Signal Router

```rust
/// Signal routing engine
pub struct SignalRouter {
    /// Domain hierarchy index
    hierarchy: DomainHierarchy,

    /// Active subscriptions
    subscriptions: HashMap<String, Vec<Subscription>>,

    /// Signal queues per domain
    queues: HashMap<DomainPath, SignalQueue>,

    /// Audit log
    audit_log: AuditLog,
}

impl SignalRouter {
    /// Emit a signal within a domain
    pub async fn emit(&self, signal: Signal) -> Result<(), SignalError> {
        // 1. Validate signal
        self.validate_signal(&signal)?;

        // 2. Deliver to local subscribers
        self.deliver_local(&signal).await?;

        // 3. Log to audit trail
        self.audit_log.record(&signal, PropagationAction::Received).await?;

        Ok(())
    }

    /// Propagate a signal through the hierarchy
    pub async fn propagate(
        &self,
        signal: Signal,
        direction: PropagationDirection,
        options: PropagationOptions,
    ) -> Result<PropagationResult, SignalError> {
        match direction {
            PropagationDirection::Up => self.propagate_up(signal, options).await,
            PropagationDirection::Down => self.propagate_down(signal, options).await,
            PropagationDirection::Siblings => self.propagate_siblings(signal, options).await,
            PropagationDirection::Both => {
                let up = self.propagate_up(signal.clone(), options.clone()).await?;
                let down = self.propagate_down(signal, options).await?;
                Ok(PropagationResult::merge(up, down))
            }
        }
    }

    async fn propagate_up(
        &self,
        mut signal: Signal,
        options: PropagationOptions,
    ) -> Result<PropagationResult, SignalError> {
        let mut result = PropagationResult::new();
        let mut current = signal.current.clone();

        while let Some(parent) = self.hierarchy.parent(&current) {
            // Check stop conditions
            if options.stop_at.contains(&parent) {
                break;
            }
            if options.skip_domains.contains(&parent) {
                current = parent;
                continue;
            }

            // Apply transformation
            if let Some(ref transform) = options.transform {
                let domain = self.hierarchy.get(&parent)?;
                match transform(&signal, &domain) {
                    Some(transformed) => signal = transformed,
                    None => break,  // Transform returned None, stop propagation
                }
            }

            // Update signal location
            signal.current = parent.clone();
            signal.history.push(PropagationEntry {
                domain: parent.clone(),
                action: PropagationAction::Received,
                timestamp: now(),
                actor: None,
            });

            // Queue for admin review or deliver immediately
            if signal.metadata.requires_ack {
                self.queue_for_review(&parent, &signal).await?;
                result.queued.push(parent.clone());
            } else {
                self.deliver_local(&signal).await?;
                result.delivered.push(parent.clone());
            }

            current = parent;
        }

        Ok(result)
    }
}
```

## Signal Patterns for Common Use Cases

### Incident Escalation

```typescript
// Room-level: Server alert detected
signals.emit({
  type: "infrastructure.alert",
  payload: {
    severity: "critical",
    server: "prod-db-01",
    message: "High CPU usage (95%)",
    metrics: { cpu: 95, memory: 78 }
  },
  metadata: { priority: "critical", requires_ack: true }
});

// Propagate upward for escalation
signals.propagate(signal, "up", {
  transform: (signal, domain) => {
    // Enrich with domain context
    return {
      ...signal,
      payload: {
        ...signal.payload,
        escalation_path: [...signal.payload.escalation_path, domain.name]
      }
    };
  }
});
```

### Command Delegation

```typescript
// Workspace-level: Deploy command from admin
signals.emit({
  type: "deployment.trigger",
  payload: {
    version: "2.3.0",
    environment: "production",
    rollback_on_failure: true
  }
});

// Propagate downward to relevant rooms
signals.propagate(signal, "down", {
  stopAt: ["room-staging"],  // Don't propagate to staging
  transform: (signal, domain) => {
    // Only propagate to rooms with deployment capability
    if (domain.metadata.has_deployment_plugin) {
      return signal;
    }
    return null;  // Skip this domain
  }
});
```

### Cross-Office Coordination

```typescript
// Engineering office signals to QA office
signals.propagate({
  type: "build.ready-for-qa",
  payload: {
    build_id: "build-12345",
    branch: "feature/new-login",
    test_plan_url: "https://..."
  }
}, "siblings", {
  filter: (domain) => domain.name.includes("QA")
});
```
