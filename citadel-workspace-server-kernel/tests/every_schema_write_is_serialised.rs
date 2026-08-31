//! The tree schema is read-modify-written, and nothing serialised it.
//!
//! `CreateNodeType` reads the schema, appends nesting rules for the new type,
//! and saves it back. Two of those running together both read the same schema,
//! each adds its own rules, and the second save overwrites the first — the
//! earlier type's rules gone, while its caller was told it succeeded. That is
//! the identical shape as the user-record and role writers, which took the
//! workspace lock for exactly this reason.
//!
//! `UpdateTreeSchema` does not race itself — it is a blind overwrite of a
//! caller-supplied schema — but landing between the other handler's read and its
//! save discards the whole schema it was given, so it takes the same lock.
//!
//! Asserted against the source, and the limit is stated: a concurrent test here
//! would be probabilistic, and this file's siblings already argue that a race
//! test which usually passes is worse than none because it reads as coverage.
//! The lock primitive itself has a 25-way concurrency test in transaction/mod.rs.

const SOURCE: &str = include_str!("../src/kernel/command_processor/async_process_command.rs");

/// Comments stripped: this campaign has already produced one source assertion
/// that matched the comment explaining the code's absence.
fn code() -> String {
    SOURCE
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn every_save_tree_schema_is_under_the_nodes_lock() {
    let code = code();
    let lines: Vec<&str> = code.lines().collect();

    let mut checked = 0usize;
    for (i, line) in lines.iter().enumerate() {
        if !line.contains(".save_tree_schema(") {
            continue;
        }
        checked += 1;

        // The guard is taken in the same match arm, which is at most a few dozen
        // lines above. Looking back a bounded window rather than to the top of
        // the function keeps a NEIGHBOUR's lock from satisfying this.
        let from = i.saturating_sub(40);
        let window = lines[from..i].join("\n");
        assert!(
            window.contains("lock_nodes()"),
            "the save_tree_schema at line {} has no lock_nodes() guard within the \
             preceding 40 lines. Two schema writers can then interleave: both read \
             the same schema, both append, and the later save discards the earlier \
             one's rules while its caller is told it succeeded.",
            i + 1
        );
    }

    assert_eq!(
        checked, 2,
        "expected two schema writers (CreateNodeType and UpdateTreeSchema), found \
         {checked}. A third would need the same lock, and finding fewer means this \
         test's matcher has stopped seeing them and is asserting nothing."
    );
}
