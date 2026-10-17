use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::structs::{Permission, User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

use common::async_test_helpers::*;
use common::workspace_test_utils::*;

/// The server ops and the role writer they delegate to, scanned as one text. Each check
/// attributes a line to the function it sits in, and no function spans the two files.
const ROLE_SOURCE: &str = concat!(
    include_str!("../src/handlers/domain/server_ops/async_domain_server_ops.rs"),
    "\n",
    include_str!("../src/handlers/domain/server_ops/role_writes.rs"),
);

/// Whether `line` opens a function, at any visibility.
fn opens_a_function(line: &str) -> bool {
    let t = line.trim_start();
    [
        "fn ",
        "async fn ",
        "pub fn ",
        "pub async fn ",
        "pub(crate) fn ",
        "pub(crate) async fn ",
    ]
    .iter()
    .any(|prefix| t.starts_with(prefix))
}

// # A workspace must never reach zero administrators
//
// The guard's own doc explains why that state is terminal: *"Demoting or
// removing the last Admin is unrecoverable: promotion requires an admin, so
// there is no way back."*
//
// SCOPE, stated plainly: this covers the SEQUENTIAL invariant only — that the
// guard refuses a removal which would empty the admin set. It does NOT cover
// the concurrent case that motivated the lock, where two admins remove each
// other, both counts complete before either write, and both pass.
//
// That interleaving cannot be asserted deterministically from here: the window
// between the count and the write is scheduler-dependent, and a probabilistic
// test that usually passes is worse than none — it reads as coverage. Verified
// by control: this test passes with the lock removed, which is exactly why it
// must not be described as testing the race.
//
// What protects the concurrent case is holding `lock_workspaces` across the
// check AND the write, in all three role writers. The lock primitive itself has
// a 25-way concurrency test in transaction/mod.rs.

/// Two admins in the root workspace, plus the seeded test admin. Written as records rather
/// than through AddMember: an Admin may not assign the admin role, their own position.
async fn seed_two_admins<R: citadel_sdk::prelude::Ratchet>(
    kernel: &citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel<R>,
    names: [&str; 2],
) {
    let mgr = &kernel.domain_operations.backend_tx_manager;
    for name in names {
        mgr.insert_user(
            name.to_string(),
            User::new(name.to_string(), name.to_string(), UserRole::Admin),
        )
        .await
        .expect("insert user");
        let mut workspace = mgr
            .get_workspace(citadel_workspace_server_kernel::WORKSPACE_ROOT_ID)
            .await
            .expect("read workspace")
            .expect("root workspace exists");
        workspace.members.push(name.to_string());
        mgr.insert_workspace(workspace.id.clone(), workspace)
            .await
            .expect("save workspace");
    }
}

/// How many members of the root workspace can manage roles.
async fn admin_count<R: citadel_sdk::prelude::Ratchet>(
    kernel: &citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel<R>,
) -> usize {
    let listed = execute_command(
        kernel,
        WorkspaceProtocolRequest::ListMembers { domain_id: None },
    )
    .await
    .expect("ListMembers dispatch failed");

    let WorkspaceProtocolResponse::Members { members, .. } = listed else {
        panic!("expected Members, got {listed:?}");
    };
    let mut managers = 0;
    for member in &members {
        if kernel
            .domain_operations
            .holds_workspace_permission(&member.id, Permission::ManageRoles)
            .await
            .expect("permission check")
        {
            managers += 1;
        }
    }
    managers
}

/// Each administrator stands down in turn. Standing down is exempt from the ladder, so the
/// only thing that can refuse the last one is the managers guard.
#[tokio::test]
async fn removing_the_last_admin_is_refused_sequentially() {
    let kernel = create_test_kernel().await;
    seed_two_admins(&kernel, ["admin_a", "admin_b"]).await;

    let before = admin_count(&kernel).await;
    assert_eq!(before, 3, "the fixture should start with three admins");

    let mut outcomes = Vec::new();
    for name in ["admin_a", "admin_b", TEST_ADMIN_USER_ID] {
        let response = process_command_with_user(
            &kernel,
            &WorkspaceProtocolRequest::RemoveMember {
                user_id: name.to_string(),
                domain_id: None,
            },
            name,
        )
        .await
        .expect("RemoveMember dispatch failed");
        outcomes.push(!matches!(response, WorkspaceProtocolResponse::Error(_)));
    }

    assert_eq!(
        outcomes,
        [true, true, false],
        "the first two may stand down; the last must be refused"
    );
    assert_eq!(
        admin_count(&kernel).await,
        1,
        "zero members able to manage roles is unrecoverable"
    );
}

/// The lock IS the protection, so the lock is what this asserts.
///
/// The previous version listed two of the three role writers and checked each
/// body for the string `lock_workspaces()`. It omitted `add_user_to_domain` —
/// whose docstring above says why: that function's guard is scoped to its
/// workspace-root branch and has dropped by the time the demote check runs.
/// Adding it to that list would have PASSED WITHOUT FIXING ANYTHING, because
/// the string is present in the branch above. A guard answering a narrower
/// question than its name.
///
/// This asserts the invariant instead of a neighbourhood: EVERY site that can
/// write a non-Admin role must sit in a function that holds `lock_workspaces()`,
/// so the last-admin count and the write cannot interleave. Writing the literal
/// `UserRole::Admin` is exempt and only that — a promotion cannot empty the
/// admin set. Enumerating the sites rather than naming functions is the point:
/// this found two role writers the previous test did not know existed.
///
/// LIMIT, stated because it is the same limit that let the old test pass: this
/// checks that the ENCLOSING FUNCTION takes the lock somewhere, not that the
/// lock is still held at the assignment. A writer reintroduced inside
/// `add_user_to_domain` would satisfy it, because that function locks in its
/// workspace-root branch. Verified by control — reintroducing exactly that
/// leaves this test green. What forbids it is
/// `every_role_writer_calls_the_guarded_writer` below, which requires the role
/// change to go through the one function where lock, check and write are
/// adjacent. Neither test is sufficient alone.
#[test]
fn every_demoting_role_write_is_under_the_workspace_lock() {
    let source = ROLE_SOURCE;

    // Comments stripped first: this campaign has already produced one source
    // assertion that matched the comment explaining the code's absence.
    let lines: Vec<&str> = source
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect();

    // Where each `fn` begins, so an assignment can be attributed to its owner.
    let fn_starts: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter(|(_, l)| opens_a_function(l))
        .map(|(i, _)| i)
        .collect();

    let mut checked = 0usize;
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        // A role write: a call of the one helper that writes a role, or an assignment
        // anywhere else. Not the helper's own definition, nor the assignments inside it,
        // which is pure and leaves the lock to whoever calls it.
        let calls_the_writer =
            trimmed.contains("assign_workspace_role(") && !opens_a_function(trimmed);
        if !calls_the_writer && !trimmed.contains(".role = ") {
            continue;
        }

        let owner_idx = *fn_starts
            .iter()
            .rfind(|&&f| f < i)
            .expect("a role assignment outside any function");
        if lines[owner_idx].contains("fn assign_workspace_role(") {
            continue;
        }
        checked += 1;
        let end = fn_starts
            .iter()
            .find(|&&f| f > owner_idx)
            .copied()
            .unwrap_or(lines.len());
        let owner = lines[owner_idx].trim();
        let body = lines[owner_idx..end].join("\n");

        assert!(
            holds_or_requires_the_lock(owner, &body),
            "`{trimmed}` (line {}) sits in `{owner}`, which does not hold \
             lock_workspaces(). Its last-admin check and its write can therefore \
             interleave with another role writer: two admins demoting each other \
             both pass the guard and the workspace is left with zero admins, \
             which is unrecoverable because promotion requires an admin.",
            i + 1
        );
    }

    assert!(
        checked >= 4,
        "found only {checked} role write(s). They are in write_user_role_locked, \
         remove_user_from_domain and the two bootstrap claims; finding fewer means \
         this test's matcher has stopped seeing them and is asserting nothing."
    );
}

/// Every caller that changes a role must go through the one guarded writer.
#[test]
fn every_role_writer_calls_the_guarded_writer() {
    let source = ROLE_SOURCE;
    let code: String = source
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");

    for writer in [
        "async fn update_workspace_member_role",
        "async fn add_user_to_domain",
    ] {
        let start = code
            .find(writer)
            .unwrap_or_else(|| panic!("{writer} no longer exists; update this test"));
        let rest = &code[start + writer.len()..];
        let end = next_function(rest);
        let body = &rest[..end];

        assert!(
            body.contains("write_user_role(") || body.contains("write_user_role_locked("),
            "{writer} changes a user's role without going through write_user_role \
             (or its _locked form under a guard the caller holds), so its \
             last-admin check and its write are not under one lock."
        );
    }

    let start = code
        .find("async fn write_user_role")
        .expect("write_user_role no longer exists; update this test");
    let rest = &code[start..];
    let end = next_function(rest);
    let body = &rest[..end];
    assert!(
        body.contains("lock_workspaces()") && body.contains("write_user_role_locked("),
        "write_user_role must take the workspace lock and delegate to the locked \
         form; it is the wrapper that makes the lock and the last-admin check one \
         step for callers that do not already hold the guard."
    );

    let start = code
        .find("async fn write_user_role_locked")
        .expect("write_user_role_locked no longer exists; update this test");
    let rest = &code[start..];
    let end = next_function(rest);
    assert!(
        rest[..end].contains("ensure_managers_remain"),
        "write_user_role_locked must run the managers check; it is where the \
         check and the write happen together under one guard."
    );
}

/// Every write of a user record must be serialised, not just the role writes.
///
/// `User` is read, modified and written back across awaits in seven places.
/// Three of them held no lock: `update_member_permissions`, `update_user_profile`
/// and `create_workspace`. Two such updates landing together both read the same
/// record, each applies its own change to its own copy, and the second
/// `insert_user` discards the first — silently, while reporting success to both
/// callers. A permission grant and a profile edit, or two grants for different
/// domains, and one of them simply did not happen.
///
/// Enumerating the write sites rather than naming the functions is deliberate:
/// that is what found these three, and it is what will find the eighth.
#[test]
fn every_user_write_is_under_the_workspace_lock() {
    let source = ROLE_SOURCE;

    let lines: Vec<&str> = source
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect();

    let fn_starts: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter(|(_, l)| opens_a_function(l))
        .map(|(i, _)| i)
        .collect();

    let mut checked = 0usize;
    for (i, line) in lines.iter().enumerate() {
        if !line.contains(".insert_user(") {
            continue;
        }
        checked += 1;

        let owner_idx = *fn_starts
            .iter()
            .rfind(|&&f| f < i)
            .expect("an insert_user outside any function");
        let end = fn_starts
            .iter()
            .find(|&&f| f > owner_idx)
            .copied()
            .unwrap_or(lines.len());
        let owner = lines[owner_idx].trim();

        assert!(
            holds_or_requires_the_lock(owner, &lines[owner_idx..end].join("\n")),
            "insert_user at line {} sits in `{owner}`, which holds no workspace \
             lock. Its read-modify-write can interleave with another user writer, \
             and the later insert silently discards the earlier change while both \
             callers are told they succeeded.",
            i + 1
        );
    }

    assert!(
        checked >= 7,
        "found only {checked} insert_user site(s); there are seven. Fewer means \
         this test's matcher has stopped seeing them and is asserting nothing."
    );
}

/// Where the function after the one `rest` starts in ends: the next line opening another.
fn next_function(rest: &str) -> usize {
    let mut offset = 0;
    for (index, line) in rest.split_inclusive('\n').enumerate() {
        if index > 0 && opens_a_function(line) {
            return offset;
        }
        offset += line.len();
    }
    rest.len()
}

/// A function satisfies the lock requirement if it takes the lock itself, or if
/// it is a `_locked` helper whose contract is that the CALLER holds it.
///
/// The exemption is only sound because `every_locked_helper_is_called_under_the_lock`
/// below checks the other half: that every call site of such a helper is itself
/// under the lock. Without that pair, the suffix would be a way to opt out of
/// the very guarantee these tests exist to enforce.
fn holds_or_requires_the_lock(owner: &str, body: &str) -> bool {
    body.contains("lock_workspaces()") || owner.contains("_locked(")
}

/// The other half of the `_locked` exemption: every caller must hold the lock.
///
/// `write_user_role` was split so `add_user_to_domain` could hold ONE guard
/// across the membership write and the role write. Before that split it took the
/// lock, dropped it, and let `write_user_role` take it again — and a removal
/// landing in the gap left a non-member holding an administrative role, which
/// `is_admin` honours and `ensure_not_last_admin` cannot see.
///
/// A split like that is exactly how a lock quietly stops being held, so the
/// exemption is paid for here.
#[test]
fn every_locked_helper_is_called_under_the_lock() {
    let source = ROLE_SOURCE;
    let lines: Vec<&str> = source
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect();

    let fn_starts: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter(|(_, l)| opens_a_function(l))
        .map(|(i, _)| i)
        .collect();

    let mut checked = 0usize;
    for (i, line) in lines.iter().enumerate() {
        // A CALL, not the definition.
        if !line.contains("_locked(") || line.trim_start().starts_with("async fn ") {
            continue;
        }
        let owner_idx = *fn_starts
            .iter()
            .rfind(|&&f| f < i)
            .expect("a _locked call outside any function");
        let end = fn_starts
            .iter()
            .find(|&&f| f > owner_idx)
            .copied()
            .unwrap_or(lines.len());
        let owner = lines[owner_idx].trim();
        // The definition line of the helper itself is not a call site.
        if owner.contains("_locked(") {
            continue;
        }
        checked += 1;

        assert!(
            lines[owner_idx..end]
                .join("\n")
                .contains("lock_workspaces()"),
            "a `_locked` helper is called at line {} inside `{owner}`, which holds \
             no workspace lock. The `_locked` suffix promises the caller holds it; \
             here nobody does, so the guarantee is gone and the suffix is a lie.",
            i + 1
        );
    }

    assert!(
        checked >= 1,
        "found no `_locked` call sites. If the helper was renamed or inlined, this \
         test is asserting nothing and the exemption in holds_or_requires_the_lock \
         must go with it."
    );
}

/// A guard that is taken and then dropped early holds nothing.
///
/// The three tests above look for `lock_workspaces()` ANYWHERE in the enclosing
/// function, which cannot see whether the guard is still live at the write. That
/// was tolerable while the only way to hold the lock was to keep the guard to
/// the end of the scope. Splitting `write_user_role` created a second way — take
/// the guard, drop it, call the unlocked form — and a control confirmed the
/// existing tests stay green through exactly that edit.
///
/// So the shape is banned outright. If a future caller genuinely needs to
/// release early, this test is the place to record why, with the interleaving it
/// is claiming to be safe.
#[test]
fn no_workspace_guard_is_released_early() {
    for (name, source) in [
        ("async_domain_server_ops.rs", ROLE_SOURCE),
        (
            "async_kernel.rs",
            include_str!("../src/kernel/async_kernel.rs"),
        ),
    ] {
        for (i, line) in source.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with("//") {
                continue;
            }
            assert!(
                !trimmed.contains("drop(_workspace_guard"),
                "{name} line {} drops the workspace guard early. Everything after \
                 it runs unlocked while the enclosing function still mentions \
                 lock_workspaces(), so the other tests in this file read it as \
                 guarded and it is not.",
                i + 1
            );
        }
    }
}
