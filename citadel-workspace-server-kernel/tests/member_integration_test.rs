//! Member Integration Tests
//!
//! This module organizes member-related integration tests into focused modules
//! for better maintainability and readability.
//!
//! Original file was 1248 lines and has been broken down into:
//! - member_operations_test.rs - Member CRUD operations
//! - permission_operations_test.rs - Permission management
//! - role_operations_test.rs - Custom role operations  
//! - admin_operations_test.rs - Admin multi-user and access control
//! - common/member_test_utils.rs - Shared test utilities

// Import all focused test modules
mod member_operations_test;
mod permission_operations_test;
mod role_operations_test;
mod admin_operations_test;

// Re-export the common module for other test files
pub mod common;

// This file now serves as an index for the modularized member integration tests.
// All original test coverage is preserved across the focused modules.
// Each module is under 250 lines and has a single, clear responsibility.
