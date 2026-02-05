use crate::kernel::transaction::{Transaction, TransactionManager};
use citadel_workspace_types::structs::UserRole;

// Define the submodules
mod member_operations;
pub mod permission_checks;
mod role_permissions;
mod transaction_operations;

// Re-export key functions and types for external users
pub use role_permissions::retrieve_role_permissions;
pub use transaction_operations::TransactionManagerExt;

/// Helper enum to distinguish domain types for permission mapping.
/// Supports both legacy fixed types (Workspace/Office/Room) and
/// the new generalized tree hierarchy with custom child types.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DomainType {
    /// Root workspace (depth 0)
    Workspace,
    /// Legacy Office type (depth 1) - maps to Child("Office")
    Office,
    /// Legacy Room type (depth 2) - maps to Child("Room")
    Room,
    /// Any custom child type in the generalized hierarchy
    Child(String),
}

impl DomainType {
    /// Create DomainType from a NodeEntityType
    pub fn from_node_entity_type(entity_type: &citadel_workspace_types::structs::NodeEntityType) -> Self {
        use citadel_workspace_types::structs::NodeEntityType;
        match entity_type {
            NodeEntityType::Workspace => DomainType::Workspace,
            NodeEntityType::Child(name) => {
                // Map known types to their legacy variants for backward compatibility
                match name.as_str() {
                    "Office" => DomainType::Office,
                    "Room" => DomainType::Room,
                    _ => DomainType::Child(name.clone()),
                }
            }
        }
    }

    /// Get the effective type name for permission lookups
    pub fn type_name(&self) -> &str {
        match self {
            DomainType::Workspace => "Workspace",
            DomainType::Office => "Office",
            DomainType::Room => "Room",
            DomainType::Child(name) => name,
        }
    }

    /// Check if this is a known type (Workspace, Office, Room)
    pub fn is_known_type(&self) -> bool {
        matches!(self, DomainType::Workspace | DomainType::Office | DomainType::Room)
    }

    /// Get the depth level for this domain type (for permission inheritance)
    /// Returns None for custom types (depth determined by tree position)
    pub fn default_depth(&self) -> Option<u32> {
        match self {
            DomainType::Workspace => Some(0),
            DomainType::Office => Some(1),
            DomainType::Room => Some(2),
            DomainType::Child(_) => None, // Depth determined by tree position
        }
    }
}

impl TransactionManager {
    /// Checks if a user has admin privileges
    pub fn is_admin(&self, user_id: &str) -> bool {
        self.with_read_transaction(|tx| {
            Ok(tx
                .get_user(user_id)
                .map(|u| u.role == UserRole::Admin)
                .unwrap_or(false))
        })
        .unwrap_or(false)
    }
}
