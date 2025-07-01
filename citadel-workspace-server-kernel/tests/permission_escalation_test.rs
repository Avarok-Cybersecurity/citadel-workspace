use citadel_workspace_server_kernel::handlers::domain::DomainOperations;
use citadel_workspace_server_kernel::handlers::domain::OfficeOperations;
use citadel_workspace_server_kernel::handlers::domain::RoomOperations;
use citadel_workspace_server_kernel::handlers::domain::{
    PermissionOperations, TransactionOperations, UserManagementOperations,
};
use citadel_workspace_server_kernel::kernel::transaction::Transaction;
use citadel_workspace_server_kernel::kernel::transaction::TransactionManagerExt;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{Permission, UserRole};

#[path = "common/mod.rs"]
mod common;
use common::permission_test_utils::*;

/// # Permission Escalation Test Suite
///
/// Tests permission escalation through role upgrades including:
/// - Creating users with basic roles
/// - Adding users to domain hierarchy
/// - Upgrading user roles to admin
/// - Verifying permission escalation takes effect
/// - Testing admin-level permissions after upgrade
///
/// ## Escalation Flow
/// ```
/// User (Member: Basic Permissions) →
/// Role Upgrade (Admin) →
/// User (Admin: Management Permissions)
/// ```
///
/// **Expected Outcome:** Role upgrades grant appropriate elevated permissions

#[test]
fn test_permission_escalation() {
    let (kernel, domain_ops, _db_temp_dir) = setup_test_environment();

    // Create a regular user
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

    // Add user to both office and room
    domain_ops
        .add_user_to_domain("admin", user_id, &office.id, UserRole::Member)
        .unwrap();
    domain_ops
        .add_user_to_domain("admin", user_id, &room.id, UserRole::Member)
        .unwrap();

    // Check basic permission
    let has_view_permission = domain_ops
        .with_read_transaction(|tx| {
            domain_ops.check_entity_permission(tx, user_id, &room.id, Permission::ViewContent)
        })
        .unwrap();
    assert!(
        has_view_permission,
        "User should have view permission on room"
    );

    // Upgrade user to room admin via role
    kernel
        .tx_manager()
        .with_write_transaction(|tx| {
            if let Some(mut user_from_db) = tx.get_user(user_id).cloned() {
                user_from_db.role = UserRole::Admin;
                tx.update_user(user_id, user_from_db)?;
                Ok(())
            } else {
                Err(citadel_sdk::prelude::NetworkError::msg("User not found"))
            }
        })
        .unwrap();

    // Now user should have admin permissions
    let has_admin_permission = domain_ops
        .with_read_transaction(|tx| {
            domain_ops.check_entity_permission(tx, user_id, &room.id, Permission::ManageRoomMembers)
        })
        .unwrap();
    assert!(
        has_admin_permission,
        "User should have admin permission after role upgrade"
    );
}
