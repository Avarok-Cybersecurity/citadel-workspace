use citadel_sdk::prelude::MonoRatchet;
use citadel_workspace_server_kernel::kernel::WorkspaceServerKernel;
use citadel_workspace_types::structs::{Permission, User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use rocksdb::DB;
use std::sync::Arc;
use tempfile::TempDir;

// Helper function to create a test kernel with an admin user
fn create_test_kernel() -> (Arc<WorkspaceServerKernel<MonoRatchet>>, TempDir) {
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

#[test]
fn test_create_workspace() {
    let (kernel, _db_temp_dir) = create_test_kernel();
    let admin_id = "admin-user";

    // Attempt to create a second workspace, which should fail in the single-workspace model
    let workspace_name = "Another Workspace";
    let workspace_description = "This should not be created";
    let result = kernel.process_command(
        admin_id,
        WorkspaceProtocolRequest::CreateWorkspace {
            name: workspace_name.to_string(),
            description: workspace_description.to_string(),
            workspace_master_password: "password".to_string(),
            metadata: None,
        },
    );

    // Verify the command fails
    assert!(
        result.is_ok(),
        "process_command should return Ok even for app errors"
    );
    match result.unwrap() {
        WorkspaceProtocolResponse::Error(e) => {
            assert_eq!(e, "Failed to create workspace: A root workspace already exists. Cannot create another one.", "Incorrect error message");
        }
        other => panic!("Expected WorkspaceProtocolResponse::Error, got {:?}", other),
    }
}

#[test]
fn test_get_workspace() {
    let (kernel, _db_temp_dir) = create_test_kernel();
    let admin_id = "admin-user";

    // Get the pre-existing workspace
    let get_result = kernel.process_command(admin_id, WorkspaceProtocolRequest::GetWorkspace);

    // Verify the response
    assert!(get_result.is_ok());
    if let Ok(WorkspaceProtocolResponse::Workspace(workspace)) = get_result {
        assert_eq!(
            workspace.id,
            citadel_workspace_server_kernel::WORKSPACE_ROOT_ID
        );
        assert_eq!(workspace.owner_id, "admin-user"); // Default admin
    } else {
        panic!("Expected Workspace response, got {:?}", get_result);
    }
}

#[test]
fn test_update_workspace() {
    let (kernel, _db_temp_dir) = create_test_kernel();
    let admin_id = "admin-user";

    // Update the pre-existing workspace
    let updated_name = "Updated Workspace Name";
    let updated_description = "An updated description";
    let update_result = kernel.process_command(
        admin_id,
        WorkspaceProtocolRequest::UpdateWorkspace {
            name: Some(updated_name.to_string()),
            description: Some(updated_description.to_string()),
            workspace_master_password: "admin-password".to_string(), // from create_test_kernel
            metadata: None,
        },
    );

    // Verify the response
    assert!(update_result.is_ok(), "Update failed: {:?}", update_result);
    if let Ok(WorkspaceProtocolResponse::Workspace(workspace)) = update_result {
        assert_eq!(
            workspace.id,
            citadel_workspace_server_kernel::WORKSPACE_ROOT_ID
        );
        assert_eq!(workspace.name, updated_name);
        assert_eq!(workspace.description, updated_description);
    } else {
        panic!("Expected Workspace response, got {:?}", update_result);
    }

    // Verify the workspace was updated in the transaction manager
    kernel
        .tx_manager()
        .with_read_transaction(|tx| {
            let workspace = tx
                .get_workspace(citadel_workspace_server_kernel::WORKSPACE_ROOT_ID)
                .unwrap();
            assert_eq!(workspace.name, updated_name);
            assert_eq!(workspace.description, updated_description);
            Ok(())
        })
        .unwrap();
}

#[test]
fn test_delete_workspace() {
    let (kernel, _db_temp_dir) = create_test_kernel();
    let admin_id = "admin-user";

    // Attempt to delete the root workspace, which should fail
    let delete_result = kernel.process_command(
        admin_id,
        WorkspaceProtocolRequest::DeleteWorkspace {
            workspace_master_password: "admin-password".to_string(),
        },
    );

    // Verify the command fails as expected
    let expected_error_msg = "Failed to delete workspace: Cannot delete the root workspace";
    match delete_result {
        Ok(WorkspaceProtocolResponse::Error(msg)) => {
            assert_eq!(msg, expected_error_msg, "Incorrect error message when attempting to delete root workspace");
        }
        Ok(other) => panic!("Expected Error response when deleting root workspace, got Ok({:?})", other),
        Err(e) => panic!("process_command returned Err({:?}) instead of Ok(Error(...)) for root workspace deletion", e),
    }

    // Verify the workspace still exists
    kernel
        .tx_manager()
        .with_read_transaction(|tx| {
            let workspace = tx.get_workspace(citadel_workspace_server_kernel::WORKSPACE_ROOT_ID);
            assert!(
                workspace.is_some(),
                "Root workspace should not have been deleted"
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn test_add_office_to_workspace() {
    let (kernel, _db_temp_dir) = create_test_kernel();
    let admin_id = "admin-user";

    // Create an office in the pre-existing workspace
    let office_name = "Test Office";
    let office_result = kernel.process_command(
        admin_id,
        WorkspaceProtocolRequest::CreateOffice {
            workspace_id: citadel_workspace_server_kernel::WORKSPACE_ROOT_ID.to_string(),
            name: office_name.to_string(),
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

    // Check that we can get the office
    let get_office_result = kernel.process_command(
        admin_id,
        WorkspaceProtocolRequest::GetOffice {
            office_id: office_id.clone(),
        },
    );
    assert!(get_office_result.is_ok());

    // Check that the office appears in the list of offices
    let list_offices_result =
        kernel.process_command(admin_id, WorkspaceProtocolRequest::ListOffices);

    match list_offices_result {
        Ok(WorkspaceProtocolResponse::Offices(offices)) => {
            assert_eq!(offices.len(), 1);
            assert_eq!(offices[0].name, office_name);
        }
        _ => panic!("Expected Offices response, got {:?}", list_offices_result),
    }
}

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
    let member_workspace_perm = kernel.tx_manager().check_entity_permission(
        member_id,
        citadel_workspace_server_kernel::WORKSPACE_ROOT_ID,
        Permission::ViewContent,
    );
    assert!(
        member_workspace_perm.unwrap(),
        "Member should have ViewContent on workspace"
    );

    // 2. Member should have ViewContent permission on office (inherited from workspace)
    let member_office_perm =
        kernel
            .tx_manager()
            .check_entity_permission(member_id, &office_id, Permission::ViewContent);
    assert!(
        member_office_perm.unwrap(),
        "Member should have ViewContent on office by inheritance"
    );

    // 3. Member should have ViewContent permission on room (inherited from workspace -> office)
    let member_room_perm =
        kernel
            .tx_manager()
            .check_entity_permission(member_id, &room_id, Permission::ViewContent);
    assert!(
        member_room_perm.unwrap(),
        "Member should have ViewContent on room by inheritance"
    );

    // 4. Member should NOT have EditContent permission on room (not granted to members)
    let member_edit_perm =
        kernel
            .tx_manager()
            .check_entity_permission(member_id, &room_id, Permission::EditContent);
    assert!(
        !member_edit_perm.unwrap(),
        "Member should NOT have EditContent on room"
    );

    // 5. Owner should have all permissions on workspace, office, and room
    let owner_edit_workspace = kernel.tx_manager().check_entity_permission(
        owner_id,
        citadel_workspace_server_kernel::WORKSPACE_ROOT_ID,
        Permission::EditContent,
    );
    let owner_edit_office =
        kernel
            .tx_manager()
            .check_entity_permission(owner_id, &office_id, Permission::EditContent);
    let owner_edit_room =
        kernel
            .tx_manager()
            .check_entity_permission(owner_id, &room_id, Permission::EditContent);

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
    let admin_edit_workspace = kernel.tx_manager().check_entity_permission(
        admin_id,
        citadel_workspace_server_kernel::WORKSPACE_ROOT_ID,
        Permission::EditContent,
    );
    let admin_edit_office =
        kernel
            .tx_manager()
            .check_entity_permission(admin_id, &office_id, Permission::EditContent);
    let admin_edit_room =
        kernel
            .tx_manager()
            .check_entity_permission(admin_id, &room_id, Permission::EditContent);

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

#[test]
fn test_load_workspace() {
    let (kernel, _db_temp_dir) = create_test_kernel();
    let admin_id = "admin-user";

    // Load the workspace (should return the single pre-existing workspace)
    let load_result = kernel.process_command(admin_id, WorkspaceProtocolRequest::LoadWorkspace);

    // Verify the response
    assert!(load_result.is_ok());
    if let Ok(WorkspaceProtocolResponse::Workspace(workspace)) = load_result {
        assert_eq!(
            workspace.id,
            citadel_workspace_server_kernel::WORKSPACE_ROOT_ID
        );
        assert_eq!(workspace.owner_id, "admin-user");
    } else {
        panic!("Expected Workspace response, got {:?}", load_result);
    }
}
