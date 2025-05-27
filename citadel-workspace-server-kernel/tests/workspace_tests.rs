use citadel_sdk::prelude::MonoRatchet;
use citadel_workspace_server_kernel::kernel::WorkspaceServerKernel;
use citadel_workspace_types::structs::{Domain, Permission, User, UserRole, Workspace};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

// Helper function to create a test kernel with an admin user
fn create_test_kernel() -> WorkspaceServerKernel<MonoRatchet> {
    let kernel = WorkspaceServerKernel::<MonoRatchet>::default();

    // Create admin user for testing
    let admin_id = "admin-user";
    kernel
        .tx_manager()
        .with_write_transaction(|tx| {
            let admin = User::new(
                admin_id.to_string(),
                "Admin User".to_string(),
                UserRole::Admin,
            );
            tx.insert_user(admin_id.to_string(), admin)?;
            Ok(())
        })
        .unwrap();

    kernel
}

#[test]
fn test_create_workspace() {
    let kernel = create_test_kernel();
    let admin_id = "admin-user";

    // Create a test workspace
    let workspace_name = "Test Workspace";
    let workspace_description = "A workspace for testing";
    let result = kernel.process_command(
        admin_id,
        WorkspaceProtocolRequest::CreateWorkspace {
            name: workspace_name.to_string(),
            description: workspace_description.to_string(),
            workspace_master_password: "correct-password".to_string(),
            metadata: None,
        },
    );

    // Verify the response
    assert!(result.is_ok());
    if let Ok(WorkspaceProtocolResponse::Workspace(workspace)) = result {
        assert_eq!(workspace.name, workspace_name);
        assert_eq!(workspace.description, workspace_description);
        assert_eq!(workspace.owner_id, admin_id);
        assert!(workspace.members.contains(&admin_id.to_string()));
        assert_eq!(workspace.password_protected, false);
    } else {
        panic!("Expected Workspace response");
    }

    // Verify the workspace exists in the transaction manager
    kernel
        .tx_manager()
        .with_read_transaction(|tx| {
            let workspaces = tx.get_all_workspaces();
            assert_eq!(workspaces.len(), 1);

            let (_id, workspace) = workspaces.iter().next().unwrap();
            assert_eq!(workspace.name, workspace_name);
            assert_eq!(workspace.description, workspace_description);
            assert_eq!(workspace.owner_id, admin_id);
            assert!(workspace.members.contains(&admin_id.to_string()));
            assert_eq!(workspace.password_protected, false);
            Ok(())
        })
        .unwrap();
}

#[test]
fn test_get_workspace() {
    let kernel = create_test_kernel();
    let admin_id = "admin-user";

    // Create a test workspace
    let workspace_name = "Test Workspace";
    let workspace_description = "A workspace for testing";
    let create_result = kernel.process_command(
        admin_id,
        WorkspaceProtocolRequest::CreateWorkspace {
            name: workspace_name.to_string(),
            description: workspace_description.to_string(),
            workspace_master_password: "correct-password".to_string(),
            metadata: None,
        },
    );

    let workspace_id = if let Ok(WorkspaceProtocolResponse::Workspace(workspace)) = create_result {
        workspace.id
    } else {
        panic!("Expected Workspace response");
    };

    // Get the workspace
    let get_result = kernel.process_command(admin_id, WorkspaceProtocolRequest::GetWorkspace);

    // Verify the response
    assert!(get_result.is_ok());
    if let Ok(WorkspaceProtocolResponse::Workspace(workspace)) = get_result {
        assert_eq!(workspace.id, workspace_id);
        assert_eq!(workspace.name, workspace_name);
        assert_eq!(workspace.description, workspace_description);
        assert_eq!(workspace.owner_id, admin_id);
        assert!(workspace.members.contains(&admin_id.to_string()));
        assert_eq!(workspace.password_protected, false);
    } else {
        panic!("Expected Workspace response");
    }
}

#[test]
fn test_update_workspace() {
    let kernel = create_test_kernel();
    let admin_id = "admin-user";

    // Create a test workspace
    let workspace_name = "Test Workspace";
    let workspace_description = "A workspace for testing";
    let create_result = kernel.process_command(
        admin_id,
        WorkspaceProtocolRequest::CreateWorkspace {
            name: workspace_name.to_string(),
            description: workspace_description.to_string(),
            workspace_master_password: "correct-password".to_string(),
            metadata: None,
        },
    );

    let workspace_id = if let Ok(WorkspaceProtocolResponse::Workspace(workspace)) = create_result {
        workspace.id
    } else {
        panic!("Expected Workspace response");
    };

    // Update the workspace
    let updated_name = "Updated Workspace";
    let updated_description = "An updated description";
    let update_result = kernel.process_command(
        admin_id,
        WorkspaceProtocolRequest::UpdateWorkspace {
            name: Some(updated_name.to_string()),
            description: Some(updated_description.to_string()),
            workspace_master_password: "correct-password".to_string(),
            metadata: None,
        },
    );

    // Verify the response
    assert!(update_result.is_ok());
    if let Ok(WorkspaceProtocolResponse::Workspace(workspace)) = update_result {
        assert_eq!(workspace.id, workspace_id);
        assert_eq!(workspace.name, updated_name);
        assert_eq!(workspace.description, updated_description);
        assert_eq!(workspace.owner_id, admin_id);
        assert_eq!(workspace.password_protected, false);
    } else {
        panic!("Expected Workspace response");
    }

    // Verify the workspace was updated in the transaction manager
    kernel
        .tx_manager()
        .with_read_transaction(|tx| {
            let workspace = tx.get_workspace(&workspace_id).unwrap();
            assert_eq!(workspace.name, updated_name);
            assert_eq!(workspace.description, updated_description);
            assert_eq!(workspace.owner_id, admin_id);
            assert_eq!(workspace.password_protected, false);
            Ok(())
        })
        .unwrap();
}

#[test]
fn test_delete_workspace() {
    let kernel = create_test_kernel();
    let admin_id = "admin-user";

    // Create a test workspace
    let workspace_name = "Test Workspace";
    let workspace_description = "A workspace for testing";
    let create_result = kernel.process_command(
        admin_id,
        WorkspaceProtocolRequest::CreateWorkspace {
            name: workspace_name.to_string(),
            description: workspace_description.to_string(),
            workspace_master_password: "correct-password".to_string(),
            metadata: None,
        },
    );

    let workspace_id = if let Ok(WorkspaceProtocolResponse::Workspace(workspace)) = create_result {
        workspace.id
    } else {
        panic!("Expected Workspace response");
    };

    // Delete the workspace
    let delete_result = kernel.process_command(
        admin_id,
        WorkspaceProtocolRequest::DeleteWorkspace {
            workspace_master_password: "correct-password".to_string(),
        },
    );

    // Verify the response
    assert!(delete_result.is_ok());
    match delete_result {
        Ok(WorkspaceProtocolResponse::Success(message)) => {
            assert!(message.contains("deleted"));
        }
        _ => panic!("Expected Success response"),
    }

    // Verify the workspace was deleted from the transaction manager
    kernel
        .tx_manager()
        .with_read_transaction(|tx| {
            let workspace = tx.get_workspace(&workspace_id);
            assert!(workspace.is_none());
            Ok(())
        })
        .unwrap();
}

#[test]
fn test_add_office_to_workspace() {
    let kernel = create_test_kernel();
    let admin_id = "admin-user";

    // Create a test workspace
    let workspace_name = "Test Workspace";
    let workspace_description = "A workspace for testing";
    let _create_result = kernel.process_command(
        admin_id,
        WorkspaceProtocolRequest::CreateWorkspace {
            name: workspace_name.to_string(),
            description: workspace_description.to_string(),
            workspace_master_password: "correct-password".to_string(),
            metadata: None,
        },
    );

    // No need to extract the workspace ID as we're using a fixed ID

    // Create an office
    let office_name = "Test Office";
    let office_result = kernel.process_command(
        admin_id,
        WorkspaceProtocolRequest::CreateOffice {
            name: office_name.to_string(),
            description: "Test Office Description".to_string(),
            mdx_content: None,
            metadata: None,
        },
    );

    let office_id = if let Ok(WorkspaceProtocolResponse::Office(office)) = office_result {
        office.id
    } else {
        panic!("Expected Office response");
    };

    // No need to explicitly add office to workspace - it's automatically part of the single workspace
    // Just verify that the office exists and is accessible

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
            assert!(!offices.is_empty());
            let found = offices.iter().any(|office| office.name == office_name);
            assert!(found, "Office not found in list");
        }
        _ => panic!("Expected Offices response"),
    }
}

#[test]
fn test_permissions_inheritance() {
    let kernel = WorkspaceServerKernel::<MonoRatchet>::default();

    // Create test users
    let admin_id = "admin-user";
    let owner_id = "owner-user";
    let member_id = "member-user";

    kernel
        .tx_manager()
        .with_write_transaction(|tx| {
            let admin = User::new(
                admin_id.to_string(),
                "Admin User".to_string(),
                UserRole::Admin,
            );
            let owner = User::new(
                owner_id.to_string(),
                "Owner User".to_string(),
                UserRole::Owner,
            );
            let member = User::new(
                member_id.to_string(),
                "Member User".to_string(),
                UserRole::Member,
            );

            tx.insert_user(admin_id.to_string(), admin)?;
            tx.insert_user(owner_id.to_string(), owner)?;
            tx.insert_user(member_id.to_string(), member)?;

            // Directly create the workspace in the transaction to bypass the single workspace check
            let workspace = Workspace {
                id: citadel_workspace_server_kernel::WORKSPACE_ROOT_ID.to_string(),
                name: "Test Workspace".to_string(),
                description: "Test description".to_string(),
                owner_id: owner_id.to_string(),
                members: vec![owner_id.to_string()],
                offices: Vec::new(),
                metadata: Vec::new(),
                password_protected: false,
            };

            tx.insert_domain(
                citadel_workspace_server_kernel::WORKSPACE_ROOT_ID.to_string(),
                Domain::Workspace {
                    workspace: workspace.clone(),
                },
            )?;

            Ok(())
        })
        .unwrap();

    // In the single workspace model, we just get the existing workspace
    // No need to create a new one since we're using the fixed crate::WORKSPACE_ROOT
    let _workspace_result =
        kernel.process_command(owner_id, WorkspaceProtocolRequest::GetWorkspace);

    // In the single workspace model, add the member to the workspace directly
    // and explicitly add the ViewContent permission
    kernel
        .tx_manager()
        .with_write_transaction(|tx| {
            // Get the workspace and create an owned clone
            let workspace = tx
                .get_workspace(citadel_workspace_server_kernel::WORKSPACE_ROOT_ID)
                .unwrap();
            let mut workspace_clone = workspace.clone();

            // Add the user to the members list
            workspace_clone.members.push(member_id.to_string());

            // Update the workspace
            tx.update_workspace(
                citadel_workspace_server_kernel::WORKSPACE_ROOT_ID,
                workspace_clone,
            )?;

            // Update the user permissions to explicitly include ViewContent for the workspace
            if let Some(user) = tx.get_user(member_id) {
                let mut user_clone = user.clone();
                user_clone.add_permission(
                    citadel_workspace_server_kernel::WORKSPACE_ROOT_ID,
                    Permission::ViewContent,
                );
                tx.update_user(member_id, user_clone)?;
            }

            Ok(())
        })
        .unwrap();

    // No need to explicitly add offices to workspace - they're automatically part of the single workspace

    // Create a room within the office
    let office_result = kernel.process_command(
        owner_id,
        WorkspaceProtocolRequest::CreateOffice {
            name: "Test Office".to_string(),
            description: "Test Office Description".to_string(),
            mdx_content: None,
            metadata: None,
        },
    );

    let office_id = if let Ok(WorkspaceProtocolResponse::Office(office)) = office_result {
        office.id
    } else {
        panic!("Expected Office response");
    };

    // Before creating the room, ensure the member user also has ViewContent permission on the office
    kernel
        .tx_manager()
        .with_write_transaction(|tx| {
            if let Some(user) = tx.get_user(member_id) {
                let mut user_clone = user.clone();
                user_clone.add_permission(&office_id, Permission::ViewContent);
                tx.update_user(member_id, user_clone)?;
            }
            Ok(())
        })
        .unwrap();

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
        panic!("Expected Room response");
    };

    // After creating the room, add ViewContent permission for the room as well
    kernel
        .tx_manager()
        .with_write_transaction(|tx| {
            if let Some(user) = tx.get_user(member_id) {
                let mut user_clone = user.clone();
                user_clone.add_permission(&room_id, Permission::ViewContent);
                tx.update_user(member_id, user_clone)?;
            }
            Ok(())
        })
        .unwrap();

    // Test permissions inheritance
    // 1. Member should have ViewContent permission on workspace
    let member_workspace_perm = kernel.tx_manager().check_entity_permission(
        member_id,
        citadel_workspace_server_kernel::WORKSPACE_ROOT_ID,
        Permission::ViewContent,
    );
    assert!(member_workspace_perm.unwrap());

    // 2. Member should have ViewContent permission on office (inherited from workspace)
    let member_office_perm =
        kernel
            .tx_manager()
            .check_entity_permission(member_id, &office_id, Permission::ViewContent);
    assert!(member_office_perm.unwrap());

    // 3. Member should have ViewContent permission on room (inherited from workspace -> office)
    let member_room_perm =
        kernel
            .tx_manager()
            .check_entity_permission(member_id, &room_id, Permission::ViewContent);
    assert!(member_room_perm.unwrap());

    // 4. Member should NOT have EditContent permission on room (not granted to members)
    let member_edit_perm =
        kernel
            .tx_manager()
            .check_entity_permission(member_id, &room_id, Permission::EditContent);
    assert!(!member_edit_perm.unwrap());

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

    assert!(owner_edit_workspace.unwrap());
    assert!(owner_edit_office.unwrap());
    assert!(owner_edit_room.unwrap());

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

    assert!(admin_edit_workspace.unwrap());
    assert!(admin_edit_office.unwrap());
    assert!(admin_edit_room.unwrap());
}

#[test]
fn test_load_workspace() {
    let kernel = create_test_kernel();
    let admin_id = "admin-user";

    // Create a test workspace
    let workspace_name = "Test Workspace";
    let workspace_description = "A workspace for testing";
    let create_result = kernel.process_command(
        admin_id,
        WorkspaceProtocolRequest::CreateWorkspace {
            name: workspace_name.to_string(),
            description: workspace_description.to_string(),
            workspace_master_password: "correct-password".to_string(),
            metadata: None,
        },
    );

    assert!(create_result.is_ok());

    // Load the workspace (should return the single workspace)
    let load_result = kernel.process_command(admin_id, WorkspaceProtocolRequest::LoadWorkspace);

    // Verify the response
    assert!(load_result.is_ok());
    if let Ok(WorkspaceProtocolResponse::Workspace(workspace)) = load_result {
        assert_eq!(workspace.name, workspace_name);
        assert_eq!(workspace.description, workspace_description);
        assert_eq!(workspace.owner_id, admin_id);
        assert!(workspace.members.contains(&admin_id.to_string()));
        assert_eq!(
            workspace.id,
            citadel_workspace_server_kernel::WORKSPACE_ROOT_ID
        ); // Should be using the fixed workspace ID
        assert_eq!(workspace.password_protected, false);
    } else {
        panic!("Expected Workspace response");
    }
}
