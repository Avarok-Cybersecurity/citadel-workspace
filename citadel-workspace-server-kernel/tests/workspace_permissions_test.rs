use citadel_workspace_server_kernel::handlers::domain::{
    DomainOperations, EntityOperations, OfficeOperations, PermissionOperations, RoomOperations,
    TransactionOperations, UserManagementOperations, WorkspaceOperations,
};
use citadel_workspace_server_kernel::kernel::transaction::Transaction;
use citadel_workspace_server_kernel::kernel::transaction::TransactionManagerExt;
use citadel_workspace_types::structs::{Permission, User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

#[path = "common/mod.rs"]
mod common;
use common::workspace_test_utils::*;

/// # Workspace Permissions and Inheritance Test Suite
///
/// Tests comprehensive permission inheritance across the workspace hierarchy including:
/// - Creating users with different roles (Admin, Owner, Member)
/// - Adding users to workspaces with specific roles
/// - Creating nested domain hierarchy (Workspace → Office → Room)
/// - Verifying permission inheritance from workspace down to rooms
/// - Testing role-based access control at each level
/// - Validating admin permissions override inheritance
///
/// ## Permission Inheritance Flow
/// ```
/// Workspace (Member: ViewContent) →
/// Office (Inherited: ViewContent) →
/// Room (Inherited: ViewContent)
///
/// Admin: All permissions regardless of membership
/// Owner: All permissions on owned entities
/// Member: ViewContent only (no EditContent)
/// ```
///
/// **Expected Outcome:** Permissions properly inherit down the hierarchy with role restrictions

#[test]
fn test_permissions_inheritance() {
    let (kernel, _db_temp_dir) = create_test_kernel();
    let admin_id = "admin-user";
    let owner_id = "owner-user";
    let member_id = "member-user";

    // Create additional users (admin is already created by create_test_kernel)
    kernel
        .tx_manager()
        .with_write_transaction(|tx| {
            let owner = User::new(
                owner_id.to_string(),
                "Owner User".to_string(),
                UserRole::Owner,
            );
            let member = User::new(
                member_id.to_string(),
                "Member User".to_string(),
                UserRole::Guest, // Start as guest, will be promoted to Member
            );
            tx.insert_user(owner_id.to_string(), owner)?;
            tx.insert_user(member_id.to_string(), member)?;
            Ok(())
        })
        .unwrap();

    // Add owner to the workspace so they can create offices/rooms
    let add_owner_result = kernel.process_command(
        admin_id,
        WorkspaceProtocolRequest::AddMember {
            user_id: owner_id.to_string(),
            office_id: None,
            room_id: None,
            role: UserRole::Owner,
            metadata: None,
        },
    );
    assert!(add_owner_result.is_ok());

    // Add member to the workspace
    let add_member_result = kernel.process_command(
        admin_id,
        WorkspaceProtocolRequest::AddMember {
            user_id: member_id.to_string(),
            office_id: None,
            room_id: None,
            role: UserRole::Member,
            metadata: None,
        },
    );
    assert!(add_member_result.is_ok());

    // Create an office, owned by owner_id
    let office_result = kernel.process_command(
        owner_id,
        WorkspaceProtocolRequest::CreateOffice {
            workspace_id: citadel_workspace_server_kernel::WORKSPACE_ROOT_ID.to_string(),
            name: "Test Office".to_string(),
            description: "Test Office Description".to_string(),
            mdx_content: None,
            metadata: None,
        },
    );

    let office_id = if let Ok(WorkspaceProtocolResponse::Office(office)) = office_result {
        office.id
    } else {
        panic!("Expected Office response, got {:?}", office_result);
    };

    // Create a room within the office
    let room_result = kernel.process_command(
        owner_id,
        WorkspaceProtocolRequest::CreateRoom {
            office_id: office_id.clone(),
            name: "Test Room".to_string(),
            description: "Test Room Description".to_string(),
            mdx_content: None,
            metadata: None,
        },
    );

    let room_id = if let Ok(WorkspaceProtocolResponse::Room(room)) = room_result {
        room.id
    } else {
        panic!("Expected Room response, got {:?}", room_result);
    };

    // Test permissions inheritance
    // 1. Member should have ViewContent permission on workspace
    let member_workspace_perm = kernel.domain_ops().with_read_transaction(|tx| {
        kernel.domain_ops().check_entity_permission(
            tx,
            member_id,
            citadel_workspace_server_kernel::WORKSPACE_ROOT_ID,
            Permission::ViewContent,
        )
    });
    assert!(
        member_workspace_perm.unwrap(),
        "Member should have ViewContent on workspace"
    );

    // 2. Member should have ViewContent permission on office (inherited from workspace)
    let member_office_perm = kernel.domain_ops().with_read_transaction(|tx| {
        kernel.domain_ops().check_entity_permission(
            tx,
            member_id,
            &office_id,
            Permission::ViewContent,
        )
    });
    assert!(
        member_office_perm.unwrap(),
        "Member should have ViewContent on office by inheritance"
    );

    // 3. Member should have ViewContent permission on room (inherited from workspace -> office)
    let member_room_perm = kernel.domain_ops().with_read_transaction(|tx| {
        kernel.domain_ops().check_entity_permission(
            tx,
            member_id,
            &room_id,
            Permission::ViewContent,
        )
    });
    assert!(
        member_room_perm.unwrap(),
        "Member should have ViewContent on room by inheritance"
    );

    // 4. Member should NOT have EditContent permission on room (not granted to members)
    let member_edit_perm = kernel.domain_ops().with_read_transaction(|tx| {
        kernel.domain_ops().check_entity_permission(
            tx,
            member_id,
            &room_id,
            Permission::EditContent,
        )
    });
    assert!(
        !member_edit_perm.unwrap(),
        "Member should NOT have EditContent on room"
    );

    // 5. Owner should have all permissions on workspace, office, and room
    let owner_edit_workspace = kernel.domain_ops().with_read_transaction(|tx| {
        kernel.domain_ops().check_entity_permission(
            tx,
            owner_id,
            citadel_workspace_server_kernel::WORKSPACE_ROOT_ID,
            Permission::EditContent,
        )
    });
    let owner_edit_office = kernel.domain_ops().with_read_transaction(|tx| {
        kernel.domain_ops().check_entity_permission(
            tx,
            owner_id,
            &office_id,
            Permission::EditContent,
        )
    });
    let owner_edit_room = kernel.domain_ops().with_read_transaction(|tx| {
        kernel
            .domain_ops()
            .check_entity_permission(tx, owner_id, &room_id, Permission::EditContent)
    });

    assert!(
        owner_edit_workspace.unwrap(),
        "Owner should have EditContent on workspace"
    );
    assert!(
        owner_edit_office.unwrap(),
        "Owner should have EditContent on office"
    );
    assert!(
        owner_edit_room.unwrap(),
        "Owner should have EditContent on room"
    );

    // 6. Admin should have all permissions regardless of membership
    let admin_edit_workspace = kernel.domain_ops().with_read_transaction(|tx| {
        kernel.domain_ops().check_entity_permission(
            tx,
            admin_id,
            citadel_workspace_server_kernel::WORKSPACE_ROOT_ID,
            Permission::EditContent,
        )
    });
    let admin_edit_office = kernel.domain_ops().with_read_transaction(|tx| {
        kernel.domain_ops().check_entity_permission(
            tx,
            admin_id,
            &office_id,
            Permission::EditContent,
        )
    });
    let admin_edit_room = kernel.domain_ops().with_read_transaction(|tx| {
        kernel
            .domain_ops()
            .check_entity_permission(tx, admin_id, &room_id, Permission::EditContent)
    });

    assert!(
        admin_edit_workspace.unwrap(),
        "Admin should have EditContent on workspace"
    );
    assert!(
        admin_edit_office.unwrap(),
        "Admin should have EditContent on office"
    );
    assert!(
        admin_edit_room.unwrap(),
        "Admin should have EditContent on room"
    );
}
