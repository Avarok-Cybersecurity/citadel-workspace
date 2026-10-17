pub mod async_domain_server_ops;
/// The role an account joining on its own is given: the table's default.
pub mod joiner_role;
pub mod metadata_merge;
/// Who holds which role, and the ladder every role or permission change climbs.
pub mod role_authority;
/// Writing a member's role, and the guard that keeps someone able to manage roles.
pub mod role_writes;
