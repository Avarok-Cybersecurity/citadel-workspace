//! Fixture accounts: one holding a built-in role in the root workspace, or one that is banned.

pub use citadel_workspace_types::roles::{
    ADMIN_ROLE_ID, GUEST_ROLE_ID, MEMBER_ROLE_ID, OWNER_ROLE_ID,
};
use citadel_workspace_types::structs::User;

/// Not a role id. Passed where a fixture takes a role, it asks for a banned account instead,
/// which holds no role anywhere.
pub const BANNED: &str = "fixture:banned";

/// An account named `name` holding `role` in the root workspace, or banned for [`BANNED`].
pub fn user_holding(id: &str, name: &str, role: &str) -> User {
    with_role(User::new(id.to_string(), name.to_string()), role)
}

/// `user` holding `role` in the root workspace, or banned for [`BANNED`].
pub fn with_role(mut user: User, role: &str) -> User {
    if role == BANNED {
        user.banned = true;
    } else {
        user.workspace_roles.insert(
            citadel_workspace_server_kernel::WORKSPACE_ROOT_ID.to_string(),
            role.to_string(),
        );
    }
    user
}

/// The `workspace_roles` of an account holding `role` in the root workspace: none for [`BANNED`].
pub fn roles_for(role: &str) -> std::collections::HashMap<String, String> {
    with_role(User::new(String::new(), String::new()), role).workspace_roles
}

/// Written where an account holds no role in the root workspace and is not banned.
pub const NO_ROLE: &str = "fixture:no-role";

/// What an account holds in the root workspace, as the fixtures name it: a role id, [`BANNED`],
/// or [`NO_ROLE`].
pub trait Standing {
    fn standing(&self) -> String;
}

impl Standing for User {
    fn standing(&self) -> String {
        if self.is_banned() {
            return BANNED.to_string();
        }
        self.role_id_in(citadel_workspace_server_kernel::WORKSPACE_ROOT_ID)
            .unwrap_or(NO_ROLE)
            .to_string()
    }
}

/// The permissions the built-in role `role_id` is seeded with.
pub fn seed_permissions(
    role_id: &str,
) -> std::collections::HashSet<citadel_workspace_types::structs::Permission> {
    citadel_workspace_types::roles::seed_roles()
        .into_iter()
        .find(|role| role.id == role_id)
        .map(|role| role.permissions)
        .expect("a built-in role id")
}
