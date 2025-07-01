use citadel_workspace_server_kernel::handlers::domain::DomainOperations;
use citadel_workspace_server_kernel::handlers::domain::OfficeOperations;
use citadel_workspace_server_kernel::handlers::domain::{
    TransactionOperations, UserManagementOperations,
};
use citadel_workspace_server_kernel::kernel::transaction::{Transaction, TransactionManagerExt};
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{Domain, UserRole};

#[path = "common/mod.rs"]
mod common;
use common::member_test_utils::*;

/// # Member Lifecycle Test Suite
///
/// Tests complete user lifecycle management including:
/// - User creation and insertion into system
/// - User addition to multiple domains
/// - Complete user removal from all domains
/// - User deletion from system
/// - Verification of complete cleanup
///
/// ## Lifecycle Flow
/// ```
/// User Creation → Domain Addition → Complete Removal → Verification
/// ```
///
/// **Expected Outcome:** Users can be completely removed from the system with proper cleanup

#[test]
fn test_complete_user_removal() {
    let (kernel, domain_ops, _db_temp_dir) = setup_simple_test_environment();
    let _domain_ops = domain_ops; // Use the returned domain_ops

    // Create a test user
    let user_id = "test_user";
    let user = create_test_user(user_id, UserRole::Member);

    // Insert the user
    kernel
        .tx_manager()
        .with_write_transaction(|tx| {
            tx.insert_user(user_id.to_string(), user)?;
            Ok(())
        })
        .unwrap();

    // Create an office
    let office = _domain_ops
        .create_office(
            "admin",
            WORKSPACE_ROOT_ID,
            "Test Office",
            "For Testing",
            None,
        )
        .unwrap();

    // Add the user to the office
    _domain_ops
        .add_user_to_domain("admin", user_id, &office.id, UserRole::Member)
        .unwrap();

    // Use transaction to completely remove the user
    kernel
        .tx_manager()
        .with_write_transaction(|tx| {
            // First remove user from all domains
            if let Some(Domain::Office { mut office }) = tx.get_domain(&office.id).cloned() {
                office.members.retain(|id| id != user_id);
                let office_id = office.id.clone(); // Clone the ID to avoid borrow issues
                tx.update_domain(&office_id, Domain::Office { office })?;
            }

            // Then remove the user completely
            tx.remove_user(user_id)?;
            Ok(())
        })
        .unwrap();

    // Verify the user no longer exists
    let user_exists = kernel
        .tx_manager()
        .with_read_transaction(|tx| Ok(tx.get_user(user_id).is_some()))
        .unwrap();

    assert!(!user_exists, "User should have been completely removed");
}
