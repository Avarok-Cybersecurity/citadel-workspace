use citadel_sdk::prelude::StackedRatchet;
use citadel_workspace_server_kernel::handlers::domain::server_ops::DomainServerOperations;
use citadel_workspace_server_kernel::kernel::WorkspaceServerKernel;
use citadel_workspace_types::structs::{User, UserRole};
use rocksdb::DB;
use std::collections::HashMap;
use std::sync::Arc;
use tempfile::TempDir;

/// Standard admin password used across permission tests
pub const ADMIN_PASSWORD: &str = "admin_password";

/// Helper function to create a test user with specified role
/// 
/// Creates a test user with:
/// - Formatted name based on ID
/// - Specified user role
/// - Empty permissions map (to be populated by tests)
/// - Default metadata
pub fn create_test_user(id: &str, role: UserRole) -> User {
    User {
        id: id.to_string(),
        name: format!("Test {}", id),
        role,
        permissions: HashMap::new(),
        metadata: Default::default(),
    }
}

/// Helper to setup a test environment with admin, domains, and test infrastructure
/// 
/// Creates a complete test environment with:
/// - Temporary RocksDB database for isolated testing
/// - WorkspaceServerKernel with admin user pre-configured
/// - DomainServerOperations for domain management
/// - Logging setup for test debugging
/// 
/// Returns the kernel, domain operations, and temp directory (must be kept alive)
pub fn setup_test_environment() -> (
    Arc<WorkspaceServerKernel<StackedRatchet>>,
    DomainServerOperations<StackedRatchet>,
    TempDir,
) {
    citadel_logging::setup_log();
    let db_temp_dir = TempDir::new().expect("Failed to create temp dir for DB");
    let db_path = db_temp_dir.path().join("test_perms_inherit_db");
    let db = DB::open_default(&db_path).expect("Failed to open DB");
    let kernel = Arc::new(WorkspaceServerKernel::<StackedRatchet>::with_admin(
        "admin",
        "Administrator",
        ADMIN_PASSWORD,
        Arc::new(db),
    ));
    let domain_ops = kernel.domain_ops().clone();

    (kernel, domain_ops, db_temp_dir)
} 