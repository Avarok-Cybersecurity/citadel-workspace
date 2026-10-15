//! A workspace still on the old default tree (rooms as leaves, depth 3) is moved to the new
//! default once, at startup. A schema an admin changed is theirs and is left as it is.

use citadel_workspace_server_kernel::kernel::tree_schema_migration::TreeSchemaMigration;
use citadel_workspace_types::structs::{NestingRule, TreeSchema};
use common::member_test_utils::GateKernel as Kernel;
use common::workspace_test_utils::create_test_kernel;

/// Written out rather than taken from the kernel, so the test cannot agree with a wrong copy.
fn old_default() -> TreeSchema {
    let rule = |parent: &str, children: &[&str]| NestingRule {
        parent_type: parent.to_string(),
        allowed_child_types: children.iter().map(|c| c.to_string()).collect(),
    };
    TreeSchema {
        rules: vec![
            rule("Workspace", &["Office"]),
            rule("Office", &["Room"]),
            rule("Room", &[]),
        ],
        max_depth: Some(3),
        ..TreeSchema::default()
    }
}

async fn stored(kernel: &Kernel) -> Option<TreeSchema> {
    kernel
        .domain_operations
        .backend_tx_manager
        .get_tree_schema()
        .await
        .expect("read schema")
}

async fn store(kernel: &Kernel, schema: &TreeSchema) {
    kernel
        .domain_operations
        .backend_tx_manager
        .save_tree_schema(schema)
        .await
        .expect("save schema");
}

async fn migrate(kernel: &Kernel) -> TreeSchemaMigration {
    kernel
        .migrate_default_tree_schema()
        .await
        .expect("migration")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_unmodified_old_default_is_rewritten() {
    let kernel = create_test_kernel().await;
    store(&kernel, &old_default()).await;

    assert_eq!(migrate(&kernel).await, TreeSchemaMigration::Rewritten);
    let schema = stored(&kernel).await.expect("schema kept");
    assert_eq!(schema.rules, TreeSchema::default().rules);
    assert_eq!(schema.max_depth, None);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_customised_schema_is_left_alone() {
    for customise in [
        |s: &mut TreeSchema| s.max_depth = Some(5),
        |s: &mut TreeSchema| {
            s.rules.push(NestingRule {
                parent_type: "Team".to_string(),
                allowed_child_types: vec![],
            })
        },
        |s: &mut TreeSchema| s.rules[1].allowed_child_types.push("Team".to_string()),
    ] {
        let kernel = create_test_kernel().await;
        let mut schema = old_default();
        customise(&mut schema);
        store(&kernel, &schema).await;

        assert_eq!(migrate(&kernel).await, TreeSchemaMigration::LeftCustomised);
        let kept = stored(&kernel).await.expect("schema kept");
        assert_eq!(
            (kept.rules, kept.max_depth),
            (schema.rules, schema.max_depth)
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_workspace_with_no_stored_schema_gets_nothing_written() {
    let kernel = create_test_kernel().await;
    let before = stored(&kernel).await;
    assert_eq!(migrate(&kernel).await, TreeSchemaMigration::NothingStored);
    assert_eq!(
        stored(&kernel).await.map(|s| s.rules),
        before.map(|s| s.rules)
    );
}

/// It runs once. An admin who later chooses the old shape on purpose keeps it.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_migration_runs_once() {
    let kernel = create_test_kernel().await;
    store(&kernel, &old_default()).await;
    assert_eq!(migrate(&kernel).await, TreeSchemaMigration::Rewritten);

    store(&kernel, &old_default()).await;
    assert_eq!(migrate(&kernel).await, TreeSchemaMigration::AlreadyMigrated);
    assert_eq!(
        stored(&kernel).await.expect("kept").rules,
        old_default().rules
    );
}
