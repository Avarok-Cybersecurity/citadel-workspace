use citadel_logging::debug;
use citadel_workspace_server_kernel::handlers::domain::DomainOperations;
use citadel_workspace_server_kernel::handlers::domain::OfficeOperations;
use citadel_workspace_server_kernel::handlers::domain::RoomOperations;
use citadel_workspace_server_kernel::handlers::domain::{
    PermissionOperations, TransactionOperations, UserManagementOperations,
};
use citadel_workspace_server_kernel::kernel::transaction::Transaction;
use citadel_workspace_server_kernel::kernel::transaction::TransactionManagerExt;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{Domain, Permission, UserRole};

#[path = "common/mod.rs"]
mod common;
use common::permission_test_utils::*;

/// # Office-Room Permission Inheritance Test Suite
///
/// Tests hierarchical permission inheritance from office to room including:
/// - Creating office and room hierarchy
/// - Adding users to office (parent) but not room (child)
/// - Verifying permission inheritance from office to room
/// - Testing view permission inheritance
/// - Ensuring inappropriate permissions are not inherited
///
/// ## Permission Inheritance Flow
/// ```
/// Office (Member: ViewContent) →
/// Room (Inherited: ViewContent from office membership)
/// ```
///
/// **Expected Outcome:** Users in parent office inherit appropriate permissions in child rooms

#[test]
fn test_office_room_permission_inheritance() {
    let (kernel, domain_ops, _db_temp_dir) = setup_test_environment();

    // Create test users with different roles
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
    let office = domain_ops
        .create_office(
            "admin",
            WORKSPACE_ROOT_ID,
            "Test Office",
            "For Testing",
            None,
        )
        .unwrap();

    // Create a room in the office
    let room = domain_ops
        .create_room("admin", &office.id, "Test Room", "Room for testing", None)
        .unwrap();

    // Add the user to the office but not the room
    domain_ops
        .add_user_to_domain("admin", user_id, &office.id, UserRole::Member)
        .unwrap();

    // Verify the user is in the office
    let office_domain_result = domain_ops
        .with_read_transaction(|tx| Ok(tx.get_domain(&office.id).cloned()))
        .unwrap();
    let office_id_for_check = office.id.clone();
    debug!(
        "[TEST_DEBUG] Created office 'OfficeInWsPermTest' with ID: {} in workspace_id: {}",
        office_id_for_check, WORKSPACE_ROOT_ID
    );
    let office_domain = office_domain_result.expect("Office domain should exist");

    match office_domain {
        Domain::Office { office } => {
            assert!(
                office.members.contains(&user_id.to_string()),
                "User should be in the office members list"
            );
        }
        _ => panic!("Expected office domain"),
    }

    // Check permission inheritance - user should have view access to the room
    // because they are a member of the parent office
    let has_room_access = domain_ops
        .with_read_transaction(|tx| domain_ops.is_member_of_domain(tx, user_id, &room.id))
        .unwrap();
    assert!(
        has_room_access,
        "User should have access to room because they're members of the parent office"
    );

    // Check view permission inheritance
    let has_view_permission = domain_ops
        .with_read_transaction(|tx| {
            domain_ops.check_entity_permission(tx, user_id, &room.id, Permission::ViewContent)
        })
        .unwrap();
    assert!(
        has_view_permission,
        "User should inherit view permission on room from parent office"
    );

    // User shouldn't have edit permission on the room
    let has_edit_permission = domain_ops
        .with_read_transaction(|tx| {
            domain_ops.check_entity_permission(tx, user_id, &room.id, Permission::SendMessages)
        })
        .unwrap();
    assert!(
        !has_edit_permission,
        "User shouldn't have SendMessages permission on room"
    );
}
