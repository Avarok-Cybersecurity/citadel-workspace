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

//! Both writers now live in `tree_schema_update.rs` and share one save, `save_validated`, which
//! expects its caller to hold the lock. So what is asserted is: no schema write anywhere else in
//! the command processor, exactly one save in that module (inside `save_validated`), and a
//! `lock_nodes()` guard in every function that calls it, taken before the call.

const PROCESSOR: &str = include_str!("../src/kernel/command_processor/async_process_command.rs");
const SCHEMA_WRITERS: &str = include_str!("../src/kernel/command_processor/tree_schema_update.rs");

/// Comments stripped: this campaign has already produced one source assertion
/// that matched the comment explaining the code's absence.
fn code(source: &str) -> Vec<String> {
    source
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .map(str::to_string)
        .collect()
}

#[test]
fn every_schema_write_is_under_the_nodes_lock() {
    assert!(
        !code(PROCESSOR)
            .iter()
            .any(|l| l.contains(".save_tree_schema(")),
        "the command processor writes the schema itself again; route it through \
         tree_schema_update::save_validated, which validates and expects the lock"
    );

    let lines = code(SCHEMA_WRITERS);
    let saves: Vec<usize> = (0..lines.len())
        .filter(|&i| lines[i].contains(".save_tree_schema("))
        .collect();
    assert_eq!(
        saves.len(),
        1,
        "expected the one save, in save_validated; found {}",
        saves.len()
    );
    let owner = lines[..saves[0]]
        .iter()
        .rev()
        .find(|l| l.contains("fn "))
        .expect("save outside a function");
    assert!(
        owner.contains("fn save_validated"),
        "the save is in `{owner}`, not save_validated"
    );

    // Every call of save_validated, and the lock taken earlier in the same function.
    let mut callers = 0usize;
    for (i, line) in lines.iter().enumerate() {
        if !line.contains("save_validated(") || line.contains("fn save_validated") {
            continue;
        }
        callers += 1;
        let start = lines[..i]
            .iter()
            .rposition(|l| l.contains("fn "))
            .expect("call outside a function");
        assert!(
            lines[start..i].iter().any(|l| l.contains("lock_nodes()")),
            "the save_validated call at line {} is not preceded by lock_nodes() in its function. \
             Two schema writers can then interleave: both read the same schema, both append, \
             and the later save discards the earlier one's rules while its caller is told it \
             succeeded.",
            i + 1
        );
    }
    assert_eq!(
        callers, 2,
        "expected two schema writers (CreateNodeType and UpdateTreeSchema), found {callers}. A \
         third would need the same lock, and finding fewer means this test's matcher has \
         stopped seeing them and is asserting nothing."
    );
}
