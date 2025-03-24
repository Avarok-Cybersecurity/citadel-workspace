use crate::structs::{User, UserRole, Permission, Domain, Office, Room};
use crate::handlers::domain_ops::{DomainOperations, ServerDomainOps};
use crate::kernel::Kernel;
use std::sync::Arc;
use uuid::Uuid;

#[cfg(test)]
mod tests {
    use super::*;
    
    fn create_test_kernel() -> Arc<Kernel> {
        let kernel = Kernel::new();
        Arc::new(kernel)
    }
    
    fn create_test_user(id: &str, role: UserRole) -> User {
        let mut user = User {
            id: id.to_string(),
            name: format!("Test User {}", id),
            email: format!("user{}@example.com", id),
            role,
            domains: vec![],
            permissions: Default::default(),
        };
        
        // Set role-based permissions
        user.set_role_permissions();
        
        user
    }
    
    fn create_test_office(owner_id: &str) -> Office {
        Office {
            id: Uuid::new_v4().to_string(),
            name: "Test Office".to_string(),
            description: "Test Office Description".to_string(),
            owner_id: owner_id.to_string(),
            members: vec![owner_id.to_string()],
        }
    }
    
    fn create_test_room(owner_id: &str, office_id: &str) -> Room {
        Room {
            id: Uuid::new_v4().to_string(),
            name: "Test Room".to_string(), 
            description: "Test Room Description".to_string(),
            owner_id: owner_id.to_string(),
            office_id: office_id.to_string(),
            members: vec![owner_id.to_string()],
        }
    }
    
    #[test]
    fn test_user_permission_management() {
        // Create a test user
        let mut user = create_test_user("user1", UserRole::Member);
        
        // Test granting a permission
        user.grant_permission("domain1", Permission::ReadMessages);
        assert!(user.has_permission("domain1", Permission::ReadMessages));
        
        // Test checking for a permission that doesn't exist
        assert!(!user.has_permission("domain1", Permission::UpdateOfficeSettings));
        
        // Test granting multiple permissions
        user.grant_permission("domain1", Permission::SendMessages);
        user.grant_permission("domain1", Permission::UpdateRoomSettings);
        
        // Test has_any_permission
        assert!(user.has_any_permission("domain1", &[Permission::UpdateOfficeSettings, Permission::ReadMessages]));
        
        // Test has_all_permissions
        assert!(user.has_all_permissions("domain1", &[Permission::ReadMessages, Permission::SendMessages]));
        assert!(!user.has_all_permissions("domain1", &[Permission::ReadMessages, Permission::ManageOfficeMembers]));
        
        // Test revoking a permission
        user.revoke_permission("domain1", Permission::SendMessages);
        assert!(!user.has_permission("domain1", Permission::SendMessages));
    }
    
    #[test]
    fn test_role_based_permissions() {
        // Create users with different roles
        let admin = create_test_user("admin", UserRole::Admin);
        let owner = create_test_user("owner", UserRole::Owner);
        let member = create_test_user("member", UserRole::Member);
        let guest = create_test_user("guest", UserRole::Guest);
        
        // Admin should have all permissions
        assert!(admin.has_permission("global", Permission::ManageOfficeMembers));
        assert!(admin.has_permission("global", Permission::UpdateOfficeSettings));
        assert!(admin.has_permission("global", Permission::CreateOffice));
        
        // Owner should have office management permissions
        assert!(owner.has_permission("global", Permission::ManageOfficeMembers));
        assert!(owner.has_permission("global", Permission::UpdateOfficeSettings));
        
        // Member should have basic messaging permissions
        assert!(member.has_permission("global", Permission::ReadMessages));
        assert!(member.has_permission("global", Permission::SendMessages));
        
        // Guest should have limited permissions
        assert!(guest.has_permission("global", Permission::ReadMessages));
        assert!(!guest.has_permission("global", Permission::SendMessages));
    }
    
    #[test]
    fn test_domain_operations_permissions() {
        // Create a kernel and domain operations instance
        let kernel = create_test_kernel();
        let domain_ops = ServerDomainOps::new(kernel.clone());
        
        // Create test users
        let admin_user = create_test_user("admin", UserRole::Admin);
        let owner_user = create_test_user("owner", UserRole::Owner);
        let member_user = create_test_user("member", UserRole::Member);
        
        // Add users to the kernel
        {
            let mut users = kernel.users.write().unwrap();
            users.insert(admin_user.id.clone(), admin_user.clone());
            users.insert(owner_user.id.clone(), owner_user.clone());
            users.insert(member_user.id.clone(), member_user.clone());
        }
        
        // Test creating an office
        let office_id = domain_ops.create_office(
            &owner_user.id, 
            "Test Office".to_string(), 
            "Test Description".to_string(), 
            vec![owner_user.id.clone(), member_user.id.clone()], 
            UserRole::Owner
        ).unwrap();
        
        // Test admin can access office
        assert!(domain_ops.can_access_domain::<Office>(&admin_user.id, &office_id).unwrap());
        
        // Test owner can access office
        assert!(domain_ops.can_access_domain::<Office>(&owner_user.id, &office_id).unwrap());
        
        // Test creating a room
        let room_id = domain_ops.create_room(
            &owner_user.id,
            &office_id,
            "Test Room".to_string(),
            "Test Room Description".to_string(),
            vec![owner_user.id.clone(), member_user.id.clone()],
            UserRole::Member
        ).unwrap();
        
        // Test admin can access room
        assert!(domain_ops.can_access_domain::<Room>(&admin_user.id, &room_id).unwrap());
        
        // Test owner can access room
        assert!(domain_ops.can_access_domain::<Room>(&owner_user.id, &room_id).unwrap());
        
        // Test member can access room
        assert!(domain_ops.can_access_domain::<Room>(&member_user.id, &room_id).unwrap());
        
        // Test entity permission checking
        assert!(domain_ops.check_entity_permission(&owner_user.id, &room_id, Permission::UpdateRoomSettings).unwrap());
        
        // Test global permission checking
        assert!(domain_ops.check_global_permission(&admin_user.id, Permission::CreateOffice).unwrap());
    }
    
    #[test]
    fn test_permission_denial() {
        // Create a kernel and domain operations instance
        let kernel = create_test_kernel();
        let domain_ops = ServerDomainOps::new(kernel.clone());
        
        // Create test users
        let owner_user = create_test_user("owner", UserRole::Owner);
        let member_user = create_test_user("member", UserRole::Member);
        let guest_user = create_test_user("guest", UserRole::Guest);
        
        // Add users to the kernel
        {
            let mut users = kernel.users.write().unwrap();
            users.insert(owner_user.id.clone(), owner_user.clone());
            users.insert(member_user.id.clone(), member_user.clone());
            users.insert(guest_user.id.clone(), guest_user.clone());
        }
        
        // Create an office owned by the owner
        let office_id = domain_ops.create_office(
            &owner_user.id, 
            "Test Office".to_string(), 
            "Test Description".to_string(), 
            vec![owner_user.id.clone()], 
            UserRole::Owner
        ).unwrap();
        
        // Create a room in the office
        let room_id = domain_ops.create_room(
            &owner_user.id,
            &office_id,
            "Test Room".to_string(),
            "Test Room Description".to_string(),
            vec![owner_user.id.clone()],
            UserRole::Member
        ).unwrap();
        
        // Test that guest cannot modify room settings
        let result = domain_ops.check_entity_permission(&guest_user.id, &room_id, Permission::UpdateRoomSettings);
        assert!(result.is_ok());
        assert!(!result.unwrap());
        
        // Test that member cannot create a room without explicit permission
        let mut member = member_user.clone();
        // Remove CreateRoom permission if any
        member.revoke_permission(&office_id, Permission::CreateRoom);
        
        {
            let mut users = kernel.users.write().unwrap();
            users.insert(member.id.clone(), member.clone());
        }
        
        let result = domain_ops.check_entity_permission(&member.id, &office_id, Permission::CreateRoom);
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }
}
