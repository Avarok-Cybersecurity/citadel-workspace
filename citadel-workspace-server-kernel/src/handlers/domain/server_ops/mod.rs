use bcrypt;
use citadel_logging::info;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{
    Domain, MetadataValue, Office, Permission, Room, User, UserRole, Workspace,
};
use citadel_workspace_types::UpdateOperation;
use serde_json;
use std::any::TypeId;
use std::sync::Arc;

use crate::handlers::domain::functions::workspace::workspace_ops::WorkspacePasswordPair;
use crate::handlers::domain::WorkspaceDBList;
use crate::kernel::transaction::{Transaction, TransactionManager, TransactionManagerExt};
use crate::WORKSPACE_ROOT_ID;

use crate::handlers::domain::functions::office::office_ops;
use crate::handlers::domain::functions::room::room_ops;
use crate::handlers::domain::functions::user as user_ops;
use crate::handlers::domain::functions::workspace::workspace_ops;
use crate::handlers::domain::DomainOperations;
use crate::handlers::domain::permission_denied;
use crate::handlers::domain::DomainEntity;

// Import submodules
mod base_operations;
mod workspace_operations;
mod office_operations;
mod room_operations;
mod user_operations;

// Re-export needed types and functions
pub use base_operations::*;
pub use workspace_operations::*;
pub use office_operations::*;
pub use room_operations::*;
pub use user_operations::*;

/// Server-side implementation of domain operations
#[derive(Clone)]
pub struct DomainServerOperations<R: Ratchet + Send + Sync + 'static> {
    pub(crate) tx_manager: Arc<RwLock<TransactionManager>>,
    _ratchet: std::marker::PhantomData<R>,
}

impl<R: Ratchet + Send + Sync + 'static> DomainServerOperations<R> {
    /// Create a new instance of DomainServerOperations
    pub fn new(kernel: Arc<RwLock<TransactionManager>>) -> Self {
        Self {
            tx_manager: kernel,
            _ratchet: std::marker::PhantomData,
        }
    }
}
