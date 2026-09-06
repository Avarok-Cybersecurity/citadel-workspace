//! You cannot unseat someone above you in the chain of command.
//!
//! `no_one_grants_a_role_above_their_own` closed one direction: you may not
//! appoint above yourself. This is the other, and it was open. Nothing anywhere
//! compared the actor against the target's CURRENT role, so the rule was "you
//! may not promote above yourself" with no matching "you may not demote someone
//! above you".
//!
//! `Permission::for_role(Banned)` is EMPTY, so the granting check passes
//! trivially for every actor: banning grants nothing. An Admin could therefore
//! ban, demote or remove the workspace's Owner through any of three doors:
//!
//!     update_workspace_member_role(admin, owner, Banned)
//!     remove_user_from_domain(admin, owner, WORKSPACE_ROOT)
//!     add_user_to_domain(admin, owner, WORKSPACE_ROOT, Banned)
//!
//! A fourth door stayed open after those three were shut, because it does not
//! write a role at all: `update_member_permissions` writes the permission MAP.
//! Its entry gate admits any Admin, its containment check only bounds what may
//! be HANDED OUT, and `Remove` is exempt from even that -- taking a permission
//! away grants nothing, exactly as banning does. So an Admin could `Set` the
//! Owner's grants to the empty set while unable to demote them by a single rank.
//!
//! `ensure_not_last_admin` is not this guard and never was: it refuses only the
//! change that empties the admin set. With two administrators present it
//! permits either to be unseated by anyone who passed the entry gate, which is
//! exactly the scenario below.
//!
//! The ladder is `UserRole::command_authority`, and it puts Owner above Admin:
//! the Owner runs the workspace and an Admin is someone they appoint. That is
//! deliberately NOT what permission-set containment says -- `for_role` gives
//! Admin the `All` wildcard and withholds it from Owner -- because those sets
//! answer "what may this role do", not "whom may this role manage".
//!
//! What must still work is asserted alongside the refusals. A rule that refused
//! everything would satisfy the refusals on its own, and would also break
//! ordinary member management: an Owner must still be able to unseat an Admin,
//! an Admin must still be able to remove a Member, and anyone must still be able
//! to stand down themselves.

use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncUserManagementOperations;
use citadel_workspace_types::structs::{Permission, UserRole};
use citadel_workspace_types::UpdateOperation;
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

async fn try_set_role_as(
    kernel: &Kernel,
    actor: &str,
    target: &str,
    role: UserRole,
) -> Result<(), String> {
    kernel
        .domain_operations
        .update_workspace_member_role(actor, target, role, None)
        .await
        .map_err(|e| e.to_string())
}

async fn try_remove_as(kernel: &Kernel, actor: &str, target: &str) -> Result<(), String> {
    kernel
        .domain_operations
        .remove_user_from_domain(actor, target, ROOT)
        .await
        .map_err(|e| e.to_string())
}

async fn try_add_as(
    kernel: &Kernel,
    actor: &str,
    target: &str,
    role: UserRole,
) -> Result<(), String> {
    kernel
        .domain_operations
        .add_user_to_domain(actor, target, ROOT, role)
        .await
        .map_err(|e| e.to_string())
}

async fn try_set_permissions_as(
    kernel: &Kernel,
    actor: &str,
    target: &str,
    permissions: Vec<Permission>,
    operation: UpdateOperation,
) -> Result<(), String> {
    kernel
        .domain_operations
        .update_member_permissions(actor, target, ROOT, permissions, operation)
        .await
        .map_err(|e| e.to_string())
}

/// The target's EXPLICIT grants at the root, which is what this door writes.
/// Not `check_entity_permission` -- that falls through to the role for a member
/// of the domain, so it would report `true` over an emptied map and hide the
/// very write being asserted about.
async fn explicit_grants(kernel: &Kernel, id: &str) -> usize {
    kernel
        .domain_operations
        .backend_tx_manager
        .get_user(id)
        .await
        .expect("read user")
        .expect("user exists")
        .permissions
        .get(ROOT)
        .map(|p| p.len())
        .unwrap_or(0)
}

async fn role_of(kernel: &Kernel, id: &str) -> UserRole {
    kernel
        .domain_operations
        .backend_tx_manager
        .get_user(id)
        .await
        .expect("read user")
        .expect("user exists")
        .role
}

/// An Owner, a standing Admin, and the kernel's own admin — so
/// `ensure_not_last_admin` has more than one administrator and cannot be the
/// thing that refuses. Whatever refuses below is this guard.
async fn owner_and_a_standing_admin() -> std::sync::Arc<Kernel> {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "owner", UserRole::Owner).await;
    join_root(&kernel, "owner").await;
    insert_user_with_role(&kernel, "admin2", UserRole::Admin).await;
    join_root(&kernel, "admin2").await;
    join_root(&kernel, TEST_ADMIN_USER_ID).await;
    kernel
}

// ---------- the three doors ----------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_cannot_ban_the_owner() {
    let kernel = owner_and_a_standing_admin().await;

    let outcome = try_set_role_as(&kernel, "admin2", "owner", UserRole::Banned).await;
    assert!(
        outcome.is_err(),
        "Banned grants nothing, so the granting check passes -- this is the only guard: {outcome:?}",
    );
    assert_eq!(
        role_of(&kernel, "owner").await,
        UserRole::Owner,
        "a refusal must also leave the role unwritten",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_cannot_demote_the_owner() {
    let kernel = owner_and_a_standing_admin().await;

    assert!(
        try_set_role_as(&kernel, "admin2", "owner", UserRole::Member)
            .await
            .is_err(),
        "Member carries less than Admin holds, so only the target's role can refuse this",
    );
    assert_eq!(role_of(&kernel, "owner").await, UserRole::Owner);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_cannot_remove_the_owner() {
    let kernel = owner_and_a_standing_admin().await;

    assert!(
        try_remove_as(&kernel, "admin2", "owner").await.is_err(),
        "removal is the same unseating by another door",
    );
    assert_eq!(role_of(&kernel, "owner").await, UserRole::Owner);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_cannot_ban_the_owner_through_add_member() {
    let kernel = owner_and_a_standing_admin().await;

    assert!(
        try_add_as(&kernel, "admin2", "owner", UserRole::Banned)
            .await
            .is_err(),
        "AddMember is a role write at the root, so it is the third door to the same demotion",
    );
    assert_eq!(role_of(&kernel, "owner").await, UserRole::Owner);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_cannot_strip_the_owners_permissions() {
    let kernel = owner_and_a_standing_admin().await;
    try_set_permissions_as(
        &kernel,
        "owner",
        "owner",
        // Not `All`: an Owner does not hold it, and `ensure_may_grant_permissions`
        // refuses it -- correctly, and from the other direction than this test.
        vec![Permission::ViewContent],
        UpdateOperation::Set,
    )
    .await
    .expect("the Owner may write their own grants");
    let before = explicit_grants(&kernel, "owner").await;
    assert_eq!(before, 1, "the fixture must have a grant to take away");

    let outcome =
        try_set_permissions_as(&kernel, "admin2", "owner", Vec::new(), UpdateOperation::Set).await;
    assert!(
        outcome.is_err(),
        "Set to the empty set hands out nothing, so the granting check passes \
         trivially -- this is the only guard: {outcome:?}",
    );
    assert_eq!(
        explicit_grants(&kernel, "owner").await,
        before,
        "a refusal must also leave the map unwritten",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_cannot_remove_the_owners_permissions() {
    let kernel = owner_and_a_standing_admin().await;
    try_set_permissions_as(
        &kernel,
        "owner",
        "owner",
        // Not `All`: an Owner does not hold it, and `ensure_may_grant_permissions`
        // refuses it -- correctly, and from the other direction than this test.
        vec![Permission::ViewContent],
        UpdateOperation::Set,
    )
    .await
    .expect("the Owner may write their own grants");

    assert!(
        try_set_permissions_as(
            &kernel,
            "admin2",
            "owner",
            vec![Permission::ViewContent],
            UpdateOperation::Remove,
        )
        .await
        .is_err(),
        "Remove is exempt from the granting check entirely, so it is the widest \
         of the four doors",
    );
    assert_eq!(explicit_grants(&kernel, "owner").await, 1);
}

// ---------- what must still work ----------
//
// Without these, a guard that refused every actor-target pair would pass every
// assertion above while breaking all of member management.

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_may_still_unseat_an_admin() {
    let kernel = owner_and_a_standing_admin().await;

    assert!(
        try_set_role_as(&kernel, "owner", "admin2", UserRole::Member)
            .await
            .is_ok(),
        "the Owner appoints administrators, so the Owner may unseat one",
    );
    assert_eq!(role_of(&kernel, "admin2").await, UserRole::Member);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_may_still_remove_an_ordinary_member() {
    let kernel = owner_and_a_standing_admin().await;
    insert_user_with_role(&kernel, "member", UserRole::Member).await;
    join_root(&kernel, "member").await;

    assert!(
        try_remove_as(&kernel, "admin2", "member").await.is_ok(),
        "ordinary member management must be untouched",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_may_still_act_on_a_peer_owner() {
    let kernel = owner_and_a_standing_admin().await;
    insert_user_with_role(&kernel, "owner2", UserRole::Owner).await;
    join_root(&kernel, "owner2").await;

    assert!(
        try_set_role_as(&kernel, "owner", "owner2", UserRole::Member)
            .await
            .is_ok(),
        "equal authority is containment, not escalation",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_may_still_stand_down() {
    let kernel = owner_and_a_standing_admin().await;

    // Self-action hands nobody any authority, and with three administrators
    // present `ensure_not_last_admin` has nothing to say either. Without this,
    // the ladder would trap the Owner: nobody outranks them, so nobody else
    // could ever demote them.
    assert!(
        try_set_role_as(&kernel, "owner", "owner", UserRole::Member)
            .await
            .is_ok(),
        "you may always relinquish your own authority",
    );
    assert_eq!(role_of(&kernel, "owner").await, UserRole::Member);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_may_still_manage_a_members_permissions() {
    let kernel = owner_and_a_standing_admin().await;
    insert_user_with_role(&kernel, "member", UserRole::Member).await;
    join_root(&kernel, "member").await;

    assert!(
        try_set_permissions_as(
            &kernel,
            "admin2",
            "member",
            vec![Permission::ViewContent],
            UpdateOperation::Add,
        )
        .await
        .is_ok(),
        "ordinary permission management must be untouched by the ladder",
    );
    assert_eq!(explicit_grants(&kernel, "member").await, 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_may_still_strip_an_admins_permissions() {
    let kernel = owner_and_a_standing_admin().await;
    try_set_permissions_as(
        &kernel,
        "owner",
        "admin2",
        vec![Permission::ViewContent],
        UpdateOperation::Set,
    )
    .await
    .expect("the Owner outranks an Admin and may write their grants");
    assert_eq!(explicit_grants(&kernel, "admin2").await, 1);
}
