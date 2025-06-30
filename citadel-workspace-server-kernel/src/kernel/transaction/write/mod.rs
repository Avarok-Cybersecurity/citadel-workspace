//! # Write Transaction Module
//!
//! This module provides the `WriteTransaction` implementation that enables safe, atomic
//! modifications to the workspace system's data layer. It manages in-memory state changes
//! and coordinates with the persistent database layer for data consistency.
//!
//! ## Transaction Architecture
//!
//! ### Write Transaction Features
//! - **Atomic Operations**: All changes are applied atomically through RocksDB batching
//! - **In-Memory Consistency**: Immediate in-memory updates with rollback capability
//! - **Change Tracking**: Comprehensive tracking of all modifications for rollback support
//! - **Delegation Pattern**: Clean separation of concerns through specialized operation modules
//!
//! ### Data Management
//! The write transaction manages three primary data types:
//! - **Domains**: Workspace entities (workspaces, offices, rooms) with hierarchical relationships
//! - **Users**: User accounts with roles, permissions, and domain memberships
//! - **Workspaces**: Top-level organizational units with master password protection
//!
//! ## Operation Categories
//! - **Password Operations**: Secure workspace password management with bcrypt hashing
//! - **Workspace Operations**: CRUD operations for workspace entities
//! - **Domain Operations**: Management of domain entities and relationships
//! - **User Operations**: User account and membership management
//! - **Role & Permission Operations**: RBAC system management
//! - **Transaction Control**: Commit and rollback operations
//!
//! ## Safety & Consistency
//! - **ACID Properties**: Ensures atomicity, consistency, isolation, and durability
//! - **Rollback Support**: Comprehensive rollback capability for transaction safety
//! - **Concurrent Access**: Thread-safe operations through RwLock mechanisms
//! - **Data Integrity**: Validation and constraint enforcement at the transaction level

use crate::kernel::transaction::{DomainChange, Transaction, UserChange, WorkspaceChange};
use citadel_logging::debug;
use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Domain, Permission, User, UserRole, Workspace};
use parking_lot::RwLockWriteGuard;
use rocksdb::DB;
use std::collections::HashMap;
use std::sync::Arc;

// ═══════════════════════════════════════════════════════════════════════════════════
// MODULE DECLARATIONS
// ═══════════════════════════════════════════════════════════════════════════════════

/// Transaction commit and persistence operations
mod commit_ops;

/// Domain entity operations (workspaces, offices, rooms)
mod domain_ops;

/// User account and membership operations
mod user_ops;

/// Workspace-specific operations and management
mod workspace_ops;

/// Transaction trait implementation (delegating to operation modules)
mod transaction_impl;

// ═══════════════════════════════════════════════════════════════════════════════════
// WRITE TRANSACTION STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════════════

/// A writable transaction that provides atomic modification capabilities for the workspace system.
///
/// `WriteTransaction` manages concurrent access to shared data structures while maintaining
/// transaction semantics including change tracking, rollback capability, and atomic commits.
/// All modifications are applied immediately to in-memory state but are only persisted
/// to the database upon successful commit.
///
/// ## Transaction Lifecycle
/// 1. **Acquisition**: Obtain write locks on all relevant data structures
/// 2. **Modification**: Apply changes to in-memory state with change tracking
/// 3. **Validation**: Ensure data consistency and constraint satisfaction
/// 4. **Commit/Rollback**: Either persist changes to database or revert in-memory state
///
/// ## Data Structures Managed
/// - **Domains**: Hierarchical workspace entities with parent-child relationships
/// - **Users**: User accounts with roles, permissions, and domain memberships
/// - **Workspaces**: Top-level organizational containers with access control
/// - **Workspace Passwords**: Secure password storage with bcrypt hashing
///
/// ## Change Tracking
/// The transaction maintains detailed change logs for rollback support:
/// - `domain_changes`: Domain insertions, updates, and deletions
/// - `user_changes`: User account modifications and membership changes
/// - `workspace_changes`: Workspace property and membership modifications
pub struct WriteTransaction<'a> {
    /// Write-locked domain entities (workspaces, offices, rooms)
    pub(crate) domains: RwLockWriteGuard<'a, HashMap<String, Domain>>,
    
    /// Write-locked user accounts and memberships
    pub(crate) users: RwLockWriteGuard<'a, HashMap<String, User>>,
    
    /// Write-locked workspace entities
    pub(crate) workspaces: RwLockWriteGuard<'a, HashMap<String, Workspace>>,
    
    /// Write-locked workspace password storage
    pub(crate) workspace_password: RwLockWriteGuard<'a, HashMap<String, String>>,
    
    /// Change tracking for domain operations (for rollback support)
    pub(crate) domain_changes: Vec<DomainChange>,
    
    /// Change tracking for user operations (for rollback support)
    pub(crate) user_changes: Vec<UserChange>,
    
    /// Change tracking for workspace operations (for rollback support)
    pub(crate) workspace_changes: Vec<WorkspaceChange>,
    
    /// Database handle for persistent storage operations
    pub(crate) db: Arc<DB>,
}

// ═══════════════════════════════════════════════════════════════════════════════════
// WRITE TRANSACTION IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════════════

impl<'a> WriteTransaction<'a> {
    
    // ────────────────────────────────────────────────────────────────────────────
    // CONSTRUCTOR AND INITIALIZATION
    // ────────────────────────────────────────────────────────────────────────────
    
    /// Creates a new write transaction with the provided write locks.
    ///
    /// This constructor initializes a new write transaction with exclusive access
    /// to all data structures. The transaction begins with empty change tracking
    /// and is ready to perform atomic operations.
    ///
    /// # Arguments
    /// * `domains` - Write lock on the domains HashMap
    /// * `users` - Write lock on the users HashMap  
    /// * `workspaces` - Write lock on the workspaces HashMap
    /// * `workspace_password` - Write lock on the workspace passwords HashMap
    /// * `db` - Shared database handle for persistence operations
    ///
    /// # Returns
    /// A new `WriteTransaction` instance ready for atomic operations
    ///
    /// # Transaction State
    /// - All change tracking vectors are initialized as empty
    /// - In-memory data structures are immediately available for modification
    /// - Database operations are deferred until commit() is called
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        domains: RwLockWriteGuard<'a, HashMap<String, Domain>>,
        users: RwLockWriteGuard<'a, HashMap<String, User>>,
        workspaces: RwLockWriteGuard<'a, HashMap<String, Workspace>>,
        workspace_password: RwLockWriteGuard<'a, HashMap<String, String>>,
        db: Arc<DB>,
    ) -> Self {
        Self {
            domains,
            users,
            workspaces,
            workspace_password,
            domain_changes: Vec::new(),
            user_changes: Vec::new(),
            workspace_changes: Vec::new(),
            db,
        }
    }

    // ────────────────────────────────────────────────────────────────────────────
    // TRANSACTION CONTROL OPERATIONS
    // ────────────────────────────────────────────────────────────────────────────

    /// Rolls back all changes made within this transaction to restore previous state.
    ///
    /// This method reverses all modifications made during the transaction by replaying
    /// the change log in reverse order. It provides transaction safety by allowing
    /// recovery from partial failures or validation errors.
    ///
    /// # Returns
    /// * `Ok(())` - All changes successfully rolled back
    /// * `Err(NetworkError)` - Rollback failed due to system error
    ///
    /// # Rollback Process
    /// 1. **Domain Changes**: Reverse all domain insertions, updates, and deletions
    /// 2. **User Changes**: Reverse all user account and membership modifications
    /// 3. **Workspace Changes**: Reverse all workspace property and membership changes
    ///
    /// # Important Notes
    /// - Changes are applied immediately to in-memory storage during the transaction
    /// - Rollback only affects in-memory state; no database changes have been persisted yet
    /// - After rollback, the transaction is in a clean state but still holds write locks
    /// - The change tracking vectors are cleared as part of the rollback process
    ///
    /// # Error Handling
    /// If rollback fails, the transaction may be in an inconsistent state and should
    /// be abandoned. The calling code should handle this as a critical system error.
    pub fn rollback(&mut self) -> Result<(), NetworkError> {
        // Revert domain changes in reverse order (LIFO)
        for change in self.domain_changes.drain(..).rev() {
            match change {
                DomainChange::Insert(id) => {
                    // Remove the inserted domain
                    self.domains.remove(&id);
                }
                DomainChange::Update(id, old_domain) => {
                    // Restore the old domain
                    self.domains.insert(id, old_domain);
                }
                DomainChange::Remove(id, old_domain) => {
                    // Re-insert the removed domain
                    self.domains.insert(id, old_domain);
                }
            }
        }

        // Revert user changes in reverse order (LIFO)
        for change in self.user_changes.drain(..).rev() {
            match change {
                UserChange::Insert(id) => {
                    // Remove the inserted user
                    self.users.remove(&id);
                }
                UserChange::Update(id, old_user) => {
                    // Restore the old user
                    self.users.insert(id, old_user);
                }
                UserChange::Remove(id, old_user) => {
                    // Re-insert the removed user
                    self.users.insert(id, old_user);
                }
            }
        }

        // Revert workspace changes in reverse order (LIFO)
        for change in self.workspace_changes.drain(..).rev() {
            match change {
                WorkspaceChange::Insert(id) => {
                    // Remove the inserted workspace
                    self.workspaces.remove(&id);
                }
                WorkspaceChange::Update(id, old_workspace) => {
                    // Restore the old workspace
                    self.workspaces.insert(id, old_workspace);
                }
                WorkspaceChange::Remove(id, old_workspace) => {
                    // Re-insert the removed workspace
                    self.workspaces.insert(id, old_workspace);
                }
            }
        }

        debug!("Transaction rollback completed successfully");
        Ok(())
    }
}
