use common::async_test_helpers::*;
use common::workspace_test_utils::*;

use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{Permission, User, UserRole};
use citadel_workspace_types::{
    UpdateOperation, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};

#[tokio::test]
async fn test_permission_operations() {
    let kernel = create_test_kernel().await;
    let root_workspace_id = WORKSPACE_ROOT_ID.to_string();

    // Create a regular user
    let user = User::new(
        "test_user".to_string(),
        "Test User".to_string(),
        UserRole::Member,
    );

    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user("test_user".to_string(), user)
        .await
        .unwrap();

    // Create an office first
    let create_office_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateOffice {
            workspace_id: root_workspace_id.clone(),
            name: "Test Office".to_string(),
            description: "Office for permission testing".to_string(),
            mdx_content: None,
            metadata: None,
            is_default: None,
        },
    )
    .await
    .unwrap();

    let office_id = match create_office_response {
        WorkspaceProtocolResponse::Office(office) => office.id,
        _ => panic!("Expected Office response"),
    };

    // Add member to office
    let add_member_cmd = WorkspaceProtocolRequest::AddMember {
        user_id: "test_user".to_string(),
        office_id: Some(office_id.clone()),
        room_id: None,
        role: UserRole::Member,
        metadata: Some("test_metadata".to_string().into_bytes()),
    };

    let response = execute_command(&kernel, add_member_cmd).await.unwrap();
    match response {
        WorkspaceProtocolResponse::Success(_) => println!("Test user added to office"),
        _ => panic!("Expected Success response"),
    }

    // Get member to check initial permissions
    let get_member_cmd = WorkspaceProtocolRequest::GetMember {
        user_id: "test_user".to_string(),
    };

    let response = execute_command(&kernel, get_member_cmd).await.unwrap();
    match response {
        WorkspaceProtocolResponse::Member(member) => {
            assert_eq!(member.id, "test_user");

            let domain_permissions = member
                .permissions
                .get(&office_id)
                .expect("Domain permissions not found");
            println!("Domain permissions: {domain_permissions:?}");

            assert!(domain_permissions.contains(&Permission::ViewContent));
            assert!(!domain_permissions.contains(&Permission::EditMdx));
            assert!(!domain_permissions.contains(&Permission::EditOfficeConfig));
        }
        _ => panic!("Expected Member response"),
    }

    // Test adding permissions
    let add_permission_cmd = WorkspaceProtocolRequest::UpdateMemberPermissions {
        user_id: "test_user".to_string(),
        domain_id: office_id.clone(),
        operation: UpdateOperation::Add,
        permissions: vec![Permission::ManageDomains],
    };

    let response = execute_command(&kernel, add_permission_cmd).await.unwrap();
    match response {
        WorkspaceProtocolResponse::Success(_) => println!("Permission added"),
        _ => panic!("Expected Success response"),
    }

    // Verify permission was added
    let get_member_cmd = WorkspaceProtocolRequest::GetMember {
        user_id: "test_user".to_string(),
    };

    let response = execute_command(&kernel, get_member_cmd).await.unwrap();
    match response {
        WorkspaceProtocolResponse::Member(member) => {
            assert_eq!(member.id, "test_user");

            let domain_permissions = member
                .permissions
                .get(&office_id)
                .expect("Domain permissions not found");
            assert!(domain_permissions.contains(&Permission::ManageDomains));
        }
        _ => panic!("Expected Member response"),
    }

    // Test removing permissions
    let remove_permission_cmd = WorkspaceProtocolRequest::UpdateMemberPermissions {
        user_id: "test_user".to_string(),
        domain_id: office_id.clone(),
        operation: UpdateOperation::Remove,
        permissions: vec![Permission::ViewContent],
    };

    let response = execute_command(&kernel, remove_permission_cmd)
        .await
        .unwrap();
    match response {
        WorkspaceProtocolResponse::Success(_) => println!("Permission removed"),
        _ => panic!("Expected Success response"),
    }

    // Verify permission was removed
    let get_member_cmd = WorkspaceProtocolRequest::GetMember {
        user_id: "test_user".to_string(),
    };

    let response = execute_command(&kernel, get_member_cmd).await.unwrap();
    match response {
        WorkspaceProtocolResponse::Member(member) => {
            let domain_permissions = member
                .permissions
                .get(&office_id)
                .expect("Domain permissions not found");
            assert!(!domain_permissions.contains(&Permission::ViewContent));
            assert!(domain_permissions.contains(&Permission::ManageDomains));
        }
        _ => panic!("Expected Member response"),
    }

    // Test setting permissions (replace all)
    let set_permission_cmd = WorkspaceProtocolRequest::UpdateMemberPermissions {
        user_id: "test_user".to_string(),
        domain_id: office_id.clone(),
        operation: UpdateOperation::Set,
        permissions: vec![Permission::SendMessages, Permission::ReadMessages],
    };

    let response = execute_command(&kernel, set_permission_cmd).await.unwrap();
    match response {
        WorkspaceProtocolResponse::Success(_) => println!("Permissions set"),
        _ => panic!("Expected Success response"),
    }

    // Verify permissions were set correctly
    let get_member_cmd = WorkspaceProtocolRequest::GetMember {
        user_id: "test_user".to_string(),
    };

    let response = execute_command(&kernel, get_member_cmd).await.unwrap();
    match response {
        WorkspaceProtocolResponse::Member(member) => {
            let domain_permissions = member
                .permissions
                .get(&office_id)
                .expect("Domain permissions not found");

            // Should only have the permissions we set
            assert_eq!(domain_permissions.len(), 2);
            assert!(domain_permissions.contains(&Permission::SendMessages));
            assert!(domain_permissions.contains(&Permission::ReadMessages));

            // Should not have previous permissions
            assert!(!domain_permissions.contains(&Permission::ManageDomains));
            assert!(!domain_permissions.contains(&Permission::ViewContent));
        }
        _ => panic!("Expected Member response"),
    }

    println!("All permission operations tests passed!");
}
