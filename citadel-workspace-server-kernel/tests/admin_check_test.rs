use citadel_workspace_server_kernel::handlers::domain::DomainOperations;
use citadel_workspace_server_kernel::handlers::domain::{
    PermissionOperations, TransactionOperations, UserManagementOperations,
};
use citadel_workspace_server_kernel::kernel::transaction::{Transaction, TransactionManagerExt};
use citadel_workspace_types::structs::{User, UserRole};

#[path = "common/mod.rs"]
mod common;
use common::permissions_test_utils::*;

/// # Admin Check Test Suite
///
/// Tests admin role verification and detection including:
/// - Verifying custom admin users are recognized
/// - Testing non-admin user detection
/// - Validating multiple admin users
/// - Ensuring admin role persistence
/// - Testing admin role assignment verification
///
/// ## Admin Detection Flow
/// ```
/// Admin Creation → Role Verification → Non-Admin Testing → Multi-Admin Validation
/// ```
///
/// **Expected Outcome:** Admin detection works correctly for various user roles and configurations

#[test]
fn test_admin_check() {
    let admin_id = "custom_admin";
    let (kernel, domain_ops, _db_temp_dir, _admin_id_str) =
        setup_custom_admin_test_environment(admin_id);

    // Verify that the admin check works with custom admin ID
    // is_admin needs a transaction
    assert!(domain_ops
        .with_read_transaction(|tx| domain_ops.is_admin_impl(tx, admin_id))
        .unwrap());

    // Create a non-admin user for testing this specific check
    let non_admin_id = "non_admin_user";
    let non_admin_user_obj = create_test_user(non_admin_id, UserRole::Member);
    kernel
        .tx_manager()
        .with_write_transaction(|tx| {
            tx.insert_user_internal(non_admin_id.to_string(), non_admin_user_obj)?;
            Ok(())
        })
        .unwrap();

    // Verify that non-admin users are recognized as such
    assert!(!domain_ops
        .with_read_transaction(|tx| domain_ops.is_admin_impl(tx, "non_admin_user"))
        .unwrap());

    // Create another user with admin role
    let second_admin_id = "second_admin";
    let admin2 = create_test_user(second_admin_id, UserRole::Admin);

    // Add the user to the kernel
    kernel
        .tx_manager()
        .with_write_transaction(|tx| {
            tx.insert_user_internal(second_admin_id.to_string(), admin2)?;
            Ok(())
        })
        .unwrap();

    // Verify that the second admin is recognized
    assert!(domain_ops
        .with_read_transaction(|tx| domain_ops.is_admin_impl(tx, second_admin_id))
        .unwrap());
}
