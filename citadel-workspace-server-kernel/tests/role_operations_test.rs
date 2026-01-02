use common::async_test_helpers::*;
use common::workspace_test_utils::*;

use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{Permission, User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

#[tokio::test]
async fn test_role_operations() {
    let kernel = create_test_kernel().await;
    let root_workspace_id = WORKSPACE_ROOT_ID.to_string();

    // Create users with different roles
    let admin_user = User::new(
        "admin_user".to_string(),
        "Admin User".to_string(),
        UserRole::Admin,
    );

    let member_user = User::new(
        "member_user".to_string(),
        "Member User".to_string(),
        UserRole::Member,
    );

    let guest_user = User::new(
        "guest_user".to_string(),
        "Guest User".to_string(),
        UserRole::Guest,
    );

    // Insert users
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user("admin_user".to_string(), admin_user)
        .await
        .unwrap();

    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user("member_user".to_string(), member_user)
        .await
        .unwrap();

    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user("guest_user".to_string(), guest_user)
        .await
        .unwrap();

    // Create an office
    let create_office_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateOffice {
            workspace_id: root_workspace_id.clone(),
            name: "Test Office".to_string(),
            description: "Office for role testing".to_string(),
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

    // Add users with different roles
    for (user_id, role_name) in [
        ("admin_user", "Admin"),
        ("member_user", "Member"),
        ("guest_user", "Guest"),
    ] {
        let role = match role_name {
            "Admin" => UserRole::Admin,
            "Member" => UserRole::Member,
            "Guest" => UserRole::Guest,
            _ => panic!("Unknown role"),
        };

        let add_member_cmd = WorkspaceProtocolRequest::AddMember {
            user_id: user_id.to_string(),
            office_id: Some(office_id.clone()),
            room_id: None,
            role: role.clone(),
            metadata: None,
        };

        let response = execute_command(&kernel, add_member_cmd).await.unwrap();
        match response {
            WorkspaceProtocolResponse::Success(_) => {
                println!("{} user added with {} role", user_id, role_name);
            }
            _ => panic!("Expected Success response"),
        }
    }

    // Verify admin user permissions
    let get_admin_cmd = WorkspaceProtocolRequest::GetMember {
        user_id: "admin_user".to_string(),
    };

    let response = execute_command(&kernel, get_admin_cmd).await.unwrap();
    match response {
        WorkspaceProtocolResponse::Member(member) => {
            assert_eq!(member.id, "admin_user");
            assert!(matches!(member.role, UserRole::Admin));

            let domain_permissions = member
                .permissions
                .get(&office_id)
                .expect("Domain permissions not found");

            // Admin should have all permissions
            assert!(domain_permissions.contains(&Permission::All));
            println!("Admin has All permissions as expected");
        }
        _ => panic!("Expected Member response"),
    }

    // Verify member user permissions
    let get_member_cmd = WorkspaceProtocolRequest::GetMember {
        user_id: "member_user".to_string(),
    };

    let response = execute_command(&kernel, get_member_cmd).await.unwrap();
    match response {
        WorkspaceProtocolResponse::Member(member) => {
            assert_eq!(member.id, "member_user");
            assert!(matches!(member.role, UserRole::Member));

            let domain_permissions = member
                .permissions
                .get(&office_id)
                .expect("Domain permissions not found");

            // Member should have specific explicit permissions
            // Note: CreateRoom is granted at check-time based on domain type (Office),
            // not stored as an explicit permission
            assert!(domain_permissions.contains(&Permission::ViewContent));
            assert!(domain_permissions.contains(&Permission::SendMessages));
            assert!(domain_permissions.contains(&Permission::ReadMessages));
            assert!(!domain_permissions.contains(&Permission::EditContent)); // Members don't have EditContent
            assert!(!domain_permissions.contains(&Permission::ManageDomains));
            assert!(!domain_permissions.contains(&Permission::All));
            println!("Member has appropriate permissions");
        }
        _ => panic!("Expected Member response"),
    }

    // Verify guest user permissions
    let get_guest_cmd = WorkspaceProtocolRequest::GetMember {
        user_id: "guest_user".to_string(),
    };

    let response = execute_command(&kernel, get_guest_cmd).await.unwrap();
    match response {
        WorkspaceProtocolResponse::Member(member) => {
            assert_eq!(member.id, "guest_user");
            assert!(matches!(member.role, UserRole::Guest));

            let domain_permissions = member
                .permissions
                .get(&office_id)
                .expect("Domain permissions not found");

            // Guest should have minimal permissions
            assert!(domain_permissions.contains(&Permission::ViewContent));
            assert!(!domain_permissions.contains(&Permission::CreateRoom));
            assert!(!domain_permissions.contains(&Permission::EditMdx));
            assert!(!domain_permissions.contains(&Permission::ManageDomains));
            println!("Guest has minimal permissions as expected");
        }
        _ => panic!("Expected Member response"),
    }

    // Test removing a member from a domain
    let remove_member_cmd = WorkspaceProtocolRequest::RemoveMember {
        user_id: "guest_user".to_string(),
        office_id: Some(office_id.clone()),
        room_id: None,
    };

    let response = execute_command(&kernel, remove_member_cmd).await.unwrap();
    match response {
        WorkspaceProtocolResponse::Success(msg) => {
            println!("Guest user removed: {}", msg);
        }
        _ => panic!("Expected Success response"),
    }

    // Verify guest user is no longer in the office domain
    let get_removed_guest_cmd = WorkspaceProtocolRequest::GetMember {
        user_id: "guest_user".to_string(),
    };

    let response = execute_command(&kernel, get_removed_guest_cmd)
        .await
        .unwrap();
    match response {
        WorkspaceProtocolResponse::Member(member) => {
            assert_eq!(member.id, "guest_user");

            // Should no longer have permissions for this office
            assert!(
                !member.permissions.contains_key(&office_id),
                "Guest should no longer have permissions for the office after removal"
            );
            println!("Guest successfully removed from office");
        }
        _ => panic!("Expected Member response"),
    }

    println!("All role operations tests passed!");
}
