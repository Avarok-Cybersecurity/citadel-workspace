//! # Domain Operations Trait Module
//!
//! This module defines the comprehensive DomainOperations trait that provides
//! the primary interface for all domain-related operations in the workspace system.
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Domain, User};

use crate::kernel::transaction::BackendTransactionManager;

/// Comprehensive trait defining all domain-level operations for the workspace system.
///
/// This trait serves as the primary interface for all domain-related operations,
/// providing a unified API for managing workspaces, offices, rooms, and their
/// associated users, permissions, and relationships.
///
/// ## Operation Categories
/// - **Core Operations**: Initialization, admin checks, user management
/// - **Transaction Management**: Safe read/write operations with proper isolation
/// - **Permission Management**: Role-based access control and authorization
/// - **Generic Entity Operations**: Type-safe CRUD operations for all entity types  
/// - **Specific Entity Operations**: Specialized operations for workspaces, offices, and rooms
/// - **Member Management**: User addition, removal, and role management
/// - **Listing Operations**: Querying and filtering entity collections
///
/// ## Thread Safety & Concurrency
/// The trait is marked with `#[auto_impl::auto_impl(Arc)]` to automatically
/// implement the trait for `Arc<T>`, enabling safe sharing across threads.
///
/// ## Error Handling
/// All operations return `Result<T, NetworkError>` with comprehensive error
/// information including permission denials, entity not found, and validation failures.
#[auto_impl::auto_impl(Arc)]
pub trait DomainOperations<R: Ratchet + Send + Sync + 'static> {
    // ────────────────────────────────────────────────────────────────────────────
    // CORE SYSTEM OPERATIONS
    // ────────────────────────────────────────────────────────────────────────────

    /// Initializes the domain operations system.
    ///
    /// This method performs any necessary setup for the domain operations
    /// including database connections, cache initialization, and system validation.
    ///
    /// # Returns
    /// * `Ok(())` - Initialization successful
    /// * `Err(NetworkError)` - Initialization failed with specific error details
    fn init(&self) -> Result<(), NetworkError>;

    /// Checks if a user has administrative privileges.
    ///
    /// Administrative privileges grant access to system-wide operations
    /// and override many standard permission checks.
    ///
    /// # Arguments
    /// * `tx` - Read transaction for database access
    /// * `user_id` - ID of the user to check for admin status
    ///
    /// # Returns
    /// * `Ok(true)` - User has admin privileges
    /// * `Ok(false)` - User does not have admin privileges
    /// * `Err(NetworkError)` - Check failed due to system error
    fn is_admin(
        &self,
        tx: &BackendTransactionManager<R>,
        user_id: &str,
    ) -> Result<bool, NetworkError>;

    /// Retrieves a user entity by their unique identifier.
    ///
    /// # Arguments
    /// * `user_id` - Unique identifier of the user to retrieve
    ///
    /// # Returns
    /// * `Some(User)` - User found and returned
    /// * `None` - User with specified ID does not exist
    fn get_user(&self, user_id: &str) -> Option<User>;

    /// Retrieves a domain entity by its unique identifier.
    ///
    /// # Arguments
    /// * `domain_id` - Unique identifier of the domain to retrieve
    ///
    /// # Returns
    /// * `Some(Domain)` - Domain found and returned
    /// * `None` - Domain with specified ID does not exist
    fn get_domain(&self, domain_id: &str) -> Option<Domain>;
}
