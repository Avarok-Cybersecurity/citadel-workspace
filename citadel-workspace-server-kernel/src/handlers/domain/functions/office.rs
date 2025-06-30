//! # Office Operations Module
//!
//! This module provides comprehensive office management functionality within workspaces.
//! It handles the complete lifecycle of office entities including creation, updates,
//! deletion, listing, and room management operations.
//!
//! ## Architecture Overview
//!
//! The office operations are organized into focused sub-modules:
//! - **`create_ops`**: Office creation operations with workspace integration
//! - **`update_ops`**: Office property update operations
//! - **`delete_ops`**: Office deletion with cascading cleanup  
//! - **`list_ops`**: Office listing with workspace filtering
//! - **`room_management`**: Office-room relationship management
//!
//! ## Key Features:
//! - **Office Creation**: Create new offices within workspaces with proper permission validation
//! - **Office Updates**: Modify office properties including name, description, and MDX content
//! - **Office Deletion**: Cascading deletion that properly handles associated rooms and cleanup
//! - **Office Listing**: Retrieve offices based on workspace membership and permissions
//! - **Room Integration**: Manage office-room relationships and operations
//!
//! ## Permission Model:
//! All operations enforce strict permission checks based on user roles and domain membership.
//! Users must have appropriate permissions (CreateOffice, UpdateOffice, DeleteOffice) to 
//! perform operations on office entities.
//!
//! ## Operation Categories
//! - **Creation Operations**: New office setup with workspace integration
//! - **Update Operations**: Property modifications and content updates
//! - **Deletion Operations**: Comprehensive cleanup with cascading operations
//! - **Listing Operations**: Permission-filtered office retrieval
//! - **Room Management**: Office-room relationship handling

pub mod office_ops {
    // ═══════════════════════════════════════════════════════════════════════════════════
    // OPERATION MODULE IMPORTS
    // ═══════════════════════════════════════════════════════════════════════════════════

    /// Office creation operations
    pub(crate) mod create_ops;
    
    /// Office update operations  
    pub(crate) mod update_ops;
    
    /// Office deletion operations with cascading cleanup
    pub(crate) mod delete_ops;
    
    /// Office listing operations with workspace filtering
    pub(crate) mod list_ops;
    
    /// Office room management operations
    pub(crate) mod room_management;

    // ═══════════════════════════════════════════════════════════════════════════════════
    // RE-EXPORTS FOR PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════════════

    // Re-export all operation functions to maintain existing API
    pub(crate) use create_ops::create_office_inner;
    pub(crate) use delete_ops::delete_office_inner;
    pub(crate) use list_ops::list_offices_inner;
    pub(crate) use room_management::remove_room_from_office_inner;
    pub(crate) use update_ops::update_office_inner;
}
