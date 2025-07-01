use citadel_sdk::prelude::MonoRatchet;
use citadel_workspace_server_kernel::kernel::WorkspaceServerKernel;
use rocksdb::DB;
use std::sync::Arc;
use tempfile::TempDir;

/// Helper function to create a test kernel with an admin user
///
/// Creates a complete test environment with:
/// - A temporary RocksDB database
/// - A WorkspaceServerKernel with admin user pre-configured
/// - Admin user: "admin-user" with password "admin-password"
/// - Root workspace pre-created and ready for operations
///
/// Returns the kernel instance and temp directory (must be kept alive for test duration)
pub fn create_test_kernel() -> (Arc<WorkspaceServerKernel<MonoRatchet>>, TempDir) {
    let db_temp_dir = TempDir::new().expect("Failed to create temp dir for DB");
    let db_path = db_temp_dir.path().join("test_workspace_db");
    let db = DB::open_default(&db_path).expect("Failed to open DB");

    let kernel = Arc::new(WorkspaceServerKernel::<MonoRatchet>::with_admin(
        "admin-user",
        "Admin User",
        "admin-password", // A dummy password
        Arc::new(db),
    ));

    (kernel, db_temp_dir)
}
