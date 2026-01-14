use citadel_workspace_types::structs::{Permission, User, UserRole};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_permission_management() {
        // Create a new regular user
        let mut user = User::new(
            "user1".to_string(),
            "Test User".to_string(),
            UserRole::Member,
        );

        // Test domain membership initially empty
        assert!(!user.is_member_of_domain("office1"));
        assert_eq!(user.get_permissions("office1"), None);

        // Test granting a permission
        user.grant_permission("office1", Permission::ReadMessages);
        assert!(user.is_member_of_domain("office1"));
        assert!(user.has_permission("office1", Permission::ReadMessages));
        assert!(!user.has_permission("office1", Permission::SendMessages));

        // Test adding more permissions
        user.add_permission("office1", Permission::SendMessages);
        assert!(user.has_permission("office1", Permission::SendMessages));

        // Test has_all_permissions and has_any_permission
        assert!(user.has_all_permissions(
            "office1",
            &[Permission::ReadMessages, Permission::SendMessages]
        ));
        assert!(
            !user.has_all_permissions("office1", &[Permission::ReadMessages, Permission::EditMdx])
        );
        assert!(
            user.has_any_permission("office1", &[Permission::SendMessages, Permission::EditMdx])
        );
        assert!(
            !user.has_any_permission("office1", &[Permission::EditMdx, Permission::UploadFiles])
        );

        // Test revoking a permission
        user.revoke_permission("office1", Permission::SendMessages);
        assert!(user.has_permission("office1", Permission::ReadMessages));
        assert!(!user.has_permission("office1", Permission::SendMessages));

        // Test clearing all permissions for a domain
        user.clear_permissions("office1");
        assert!(!user.is_member_of_domain("office1"));
        assert_eq!(user.get_permissions("office1"), None);

        // Test setting role-based permissions
        user.set_role_permissions("office1");
        assert!(user.is_member_of_domain("office1"));
        // Member role should have these permissions
        assert!(user.has_permission("office1", Permission::SendMessages));
        assert!(user.has_permission("office1", Permission::ReadMessages));
        assert!(user.has_permission("office1", Permission::UploadFiles));
        assert!(user.has_permission("office1", Permission::DownloadFiles));
    }

    #[test]
    fn test_admin_permissions() {
        // Create admin user
        let mut admin = User::new(
            "admin1".to_string(),
            "Admin User".to_string(),
            UserRole::Admin,
        );

        // Set role permissions for a domain
        admin.set_role_permissions("system");

        // Admin should have all permissions
        for permission in [
            Permission::ReadMessages,
            Permission::SendMessages,
            Permission::EditMdx,
            Permission::ManageDomains,
            Permission::ConfigureSystem,
            Permission::DeleteOffice,
        ] {
            assert!(admin.has_permission("system", permission));
        }

        // Test the has_all_permissions method with admin
        assert!(admin.has_all_permissions(
            "system",
            &[
                Permission::ReadMessages,
                Permission::EditMdx,
                Permission::DeleteOffice,
            ]
        ));

        // Verify that admin role is correctly identified
        assert!(admin.is_administrator());
    }

    #[test]
    fn test_multiple_domains() {
        // Create a regular user
        let mut user = User::new(
            "user2".to_string(),
            "Multi-Domain User".to_string(),
            UserRole::Member,
        );

        // Grant different permissions to different domains
        user.grant_permission("office1", Permission::ReadMessages);
        user.grant_permission("office1", Permission::SendMessages);
        user.grant_permission("room1", Permission::ReadMessages);
        user.grant_permission("room2", Permission::ReadMessages);
        user.grant_permission("room2", Permission::UploadFiles);

        // Verify domain-specific permissions
        assert!(user.has_permission("office1", Permission::SendMessages));
        assert!(!user.has_permission("room1", Permission::SendMessages));
        assert!(user.has_permission("room2", Permission::UploadFiles));
        assert!(!user.has_permission("room1", Permission::UploadFiles));

        // Revoke permission from one domain should not affect others
        user.revoke_permission("office1", Permission::SendMessages);
        assert!(!user.has_permission("office1", Permission::SendMessages));
        assert!(user.has_permission("office1", Permission::ReadMessages));
        assert!(user.has_permission("room1", Permission::ReadMessages));

        // Clear permissions from one domain should not affect others
        user.clear_permissions("room1");
        assert!(!user.is_member_of_domain("room1"));
        assert!(user.is_member_of_domain("office1"));
        assert!(user.is_member_of_domain("room2"));
    }

    #[test]
    fn test_non_existent_domains() {
        // Test behavior with non-existent domains
        let user = User::new(
            "user3".to_string(),
            "Test User".to_string(),
            UserRole::Member,
        );

        // These should all handle non-existent domains gracefully
        assert!(!user.is_member_of_domain("non_existent"));
        assert!(!user.has_permission("non_existent", Permission::ReadMessages));
        assert!(!user.has_any_permission("non_existent", &[Permission::ReadMessages]));
        assert!(!user.has_all_permissions("non_existent", &[Permission::ReadMessages]));

        // These operations should not panic on non-existent domains
        let mut user_mut = user.clone();
        user_mut.revoke_permission("non_existent", Permission::ReadMessages);
        user_mut.clear_permissions("non_existent");
    }
}
