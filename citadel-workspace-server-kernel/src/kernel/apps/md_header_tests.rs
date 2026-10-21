//! The header rules on their own: who may change it, and the kernel's inject and remove.

use super::md_header::*;

const KANBAN: &str = r#"{/* @citadel-apps 1 {"require":[{"app":"com.acme.kanban","min":"1.2.0","surface":"none"}]} */}"#;
const BOTH: &str = r#"{/* @citadel-apps 1 {"require":[{"app":"com.acme.kanban","min":"1.2.0","surface":"none"},{"app":"com.acme.lint","min":"0.9.0","surface":"none"}]} */}"#;

#[test]
fn an_edit_without_app_manage_must_carry_the_header_byte_for_byte() {
    let stored = format!("{KANBAN}\n# Plan\n");
    let body_only = format!("{KANBAN}\n# Plan, revised\n");
    assert_eq!(check_header_edit(&stored, &body_only, false), Ok(()));
    assert_eq!(check_header_edit("# Plan\n", "# Other\n", false), Ok(()));
    for changed in [
        "# Plan\n".to_string(),
        format!("{BOTH}\n# Plan\n"),
        format!("{} \n# Plan\n", KANBAN),
    ] {
        assert_eq!(
            check_header_edit(&stored, &changed, false),
            Err(HEADER_MANAGED.to_string()),
            "{changed}"
        );
        assert_eq!(check_header_edit(&stored, &changed, true), Ok(()));
    }
    assert_eq!(
        check_header_edit("# Plan\n", &format!("{KANBAN}\n# Plan\n"), false),
        Err(HEADER_MANAGED.to_string()),
        "adding a header is changing it"
    );
}

#[test]
fn inject_writes_a_normalised_header_and_leaves_an_existing_entry_alone() {
    assert_eq!(
        inject("# Plan\n", "com.acme.kanban", "1.2.0").unwrap(),
        Some(format!("{KANBAN}\n# Plan\n"))
    );
    let with_lint = r#"{/* @citadel-apps 1 {"require":[{"app":"com.acme.lint","min":"0.9.0","surface":"none"}]} */}"#;
    assert_eq!(
        inject(
            &format!("{with_lint}\n# Plan\n"),
            "com.acme.kanban",
            "1.2.0"
        )
        .unwrap(),
        Some(format!("{BOTH}\n# Plan\n")),
        "sorted by app"
    );
    let stored = format!("{KANBAN}\n# Plan\n");
    assert_eq!(inject(&stored, "com.acme.kanban", "2.0.0").unwrap(), None);
    assert!(inject(&format!("{KANBAN}\n{KANBAN}\n"), "com.acme.lint", "1.0.0").is_err());
}

#[test]
fn remove_takes_exactly_the_named_entry_and_an_empty_header_with_it() {
    assert_eq!(
        remove(&format!("{BOTH}\n# Plan\n"), "com.acme.lint").unwrap(),
        Some(format!("{KANBAN}\n# Plan\n"))
    );
    assert_eq!(
        remove(&format!("{KANBAN}\n# Plan\n"), "com.acme.kanban").unwrap(),
        Some("# Plan\n".to_string())
    );
    assert_eq!(
        remove(&format!("{KANBAN}\n# Plan\n"), "com.acme.lint").unwrap(),
        None
    );
    assert_eq!(remove("# Plan\n", "com.acme.kanban").unwrap(), None);
}
