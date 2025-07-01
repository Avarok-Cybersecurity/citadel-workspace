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

/// # Member Domain Operations Test Suite
///
/// Tests basic member operations within domain hierarchy including:
/// - Adding users to domains (offices, rooms, etc.)
/// - Removing users from domains
/// - Verifying domain membership changes
/// - Testing proper member list updates
///
/// ## Test Coverage
/// - User addition to office domains
/// - User removal from office domains
/// - Membership verification after operations
///
/// **Expected Outcome:** Domain membership operations work correctly and maintain consistent state

#[test]
fn test_add_user_to_domain() {
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

    // Verify the user is in the office
    let office_domain = _domain_ops.get_domain(&office.id).unwrap();
    match office_domain {
        Domain::Office { office } => {
            assert!(
                office.members.contains(&user_id.to_string()),
                "User should be in the office members list"
            );
        }
        _ => panic!("Expected office domain"),
    }
}

#[test]
fn test_remove_user_from_domain() {
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

    // Add the user to the office first
    _domain_ops
        .add_user_to_domain("admin", user_id, &office.id, UserRole::Member)
        .unwrap();

    // Remove the user from the office
    _domain_ops
        .remove_user_from_domain("admin", user_id, &office.id)
        .unwrap();

    // Verify the user is no longer in the office
    let office_domain = _domain_ops.get_domain(&office.id).unwrap();
    match office_domain {
        Domain::Office { office } => {
            assert!(
                !office.members.contains(&user_id.to_string()),
                "User should not be in the office members list after removal"
            );
        }
        _ => panic!("Expected office domain"),
    }
}
