use citadel_sdk::prelude::StackedRatchet;
use citadel_workspace_server_kernel::handlers::domain::server_ops::DomainServerOperations;
use citadel_workspace_server_kernel::handlers::domain::DomainOperations;
use citadel_workspace_server_kernel::kernel::WorkspaceServerKernel;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{Domain, Permission, User, UserRole};
use rocksdb::DB;
use std::collections::HashMap;
use std::sync::Arc;
use tempfile::TempDir;

const ADMIN_PASSWORD: &str = "admin_password";

// Helper function to create a test user
fn create_test_user(id: &str, role: UserRole) -> User {
    User {
        id: id.to_string(),
        name: format!("Test {}", id),
        role,
        permissions: HashMap::new(),
        metadata: Default::default(),
    }
}

// Helper to setup a test environment with admin, domains, and test users
fn setup_test_environment() -> (
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
            &WORKSPACE_ROOT_ID.to_string(),
            "Test Office",
            "For Testing",
            None,
        )
        .unwrap();

    // Create a room in the office
    let room = domain_ops
        .create_room("admin", &office, "Test Room", "Room for testing", None)
        .unwrap();

    // Add the user to the office but not the room
    domain_ops
        .add_user_to_domain("admin", user_id, &office, UserRole::Member)
        .unwrap();

    // Verify the user is in the office
    let office_domain_result = domain_ops
        .with_read_transaction(|tx| Ok(tx.get_domain(&office).cloned()))
        .unwrap();
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
            &WORKSPACE_ROOT_ID.to_string(),
            "Test Office",
            "For Testing",
            None,
        )
        .unwrap();

    // Create a room in the office
    let room = domain_ops
        .create_room("admin", &office, "Test Room", "Room for testing", None)
        .unwrap();

    // Add user to both office and room
    domain_ops
        .add_user_to_domain("admin", user_id, &office, UserRole::Member)
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

#[test]
fn test_is_member_of_domain_behavior() {
    let (kernel, domain_ops, _db_temp_dir) = setup_test_environment();

    // Create test users
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
            "test_ws_id_perms",
            "Test Office",
            "For Testing",
            None,
        )
        .unwrap();

    // Create a room in the office
    let room = domain_ops
        .create_room("admin", &office, "Test Room", "Room for testing", None)
        .unwrap();

    // Initially user is not a member of any domain
    let is_member_office = domain_ops
        .with_read_transaction(|tx| domain_ops.is_member_of_domain(tx, user_id, &office))
        .unwrap();
    let is_member_room = domain_ops
        .with_read_transaction(|tx| domain_ops.is_member_of_domain(tx, user_id, &room.id))
        .unwrap();

    assert!(
        !is_member_office,
        "User should not be member of office initially"
    );
    assert!(
        !is_member_room,
        "User should not be member of room initially"
    );

    // Add user to the office only
    domain_ops
        .add_user_to_domain("admin", user_id, &office, UserRole::Member)
        .unwrap();

    // Now user should be a member of the office but not the room
    let is_member_office = domain_ops
        .with_read_transaction(|tx| domain_ops.is_member_of_domain(tx, user_id, &office))
        .unwrap();
    let is_member_room = domain_ops
        .with_read_transaction(|tx| domain_ops.is_member_of_domain(tx, user_id, &room.id))
        .unwrap();

    assert!(
        is_member_office,
        "User should be member of office after addition"
    );
    assert!(
        !is_member_room, // This is checking direct membership, not inherited.
        "User should still not be member of room directly"
    );

    // But user should still have access to the room because of permission inheritance (implicitly a member for access purposes)
    let has_room_access_via_inheritance = domain_ops
        .with_read_transaction(|tx| domain_ops.is_member_of_domain(tx, user_id, &room.id))
        .unwrap();
    assert!(
        has_room_access_via_inheritance,
        "User should have room access because they're in the parent office"
    );
}
