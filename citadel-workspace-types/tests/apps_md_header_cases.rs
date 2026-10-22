//! Every header case splits, joins and reads as recorded; the cases are also written to
//! `bindings/md-header-fixtures.json`, which the UI's `md-header.ts` is tested against, so the two
//! `split`s cannot drift.

mod apps_fixture;

use apps_fixture::md::{KANBAN, TWO};
use citadel_workspace_types::apps_md_header::{join, read_document, split};

/// (name, content, header line split finds, body, whether the document reads).
fn cases() -> Vec<(&'static str, String, Option<String>, String, bool)> {
    let doc = |header: &str, body: &str| format!("{header}\n{body}");
    vec![
        (
            "no header",
            "# Notes\nhello".into(),
            None,
            "# Notes\nhello".into(),
            true,
        ),
        ("empty document", String::new(), None, String::new(), true),
        (
            "one requirement",
            doc(KANBAN, "# Board"),
            Some(KANBAN.into()),
            "# Board".into(),
            true,
        ),
        (
            "two requirements",
            doc(TWO, ""),
            Some(TWO.into()),
            String::new(),
            true,
        ),
        (
            "header only, no newline",
            KANBAN.into(),
            Some(KANBAN.into()),
            String::new(),
            true,
        ),
        (
            "header then blank body line",
            doc(KANBAN, "\nx"),
            Some(KANBAN.into()),
            "\nx".into(),
            true,
        ),
        (
            "leading space is body",
            format!(" {KANBAN}\nx"),
            None,
            format!(" {KANBAN}\nx"),
            false,
        ),
        (
            "second line header",
            format!("# Title\n{KANBAN}"),
            None,
            format!("# Title\n{KANBAN}"),
            false,
        ),
        (
            "two headers",
            doc(KANBAN, KANBAN),
            Some(KANBAN.into()),
            KANBAN.into(),
            false,
        ),
        (
            "crlf after header",
            format!("{KANBAN}\r\nx"),
            Some(format!("{KANBAN}\r")),
            "x".into(),
            false,
        ),
        (
            "other version",
            doc(&KANBAN.replace("apps 1 ", "apps 2 "), "x"),
            Some(KANBAN.replace("apps 1 ", "apps 2 ")),
            "x".into(),
            false,
        ),
        (
            "spaced json",
            doc(&KANBAN.replace("\":[", "\": ["), "x"),
            Some(KANBAN.replace("\":[", "\": [")),
            "x".into(),
            false,
        ),
        (
            "unsorted",
            doc(&TWO.replace("kanban", "zzz"), "x"),
            Some(TWO.replace("kanban", "zzz")),
            "x".into(),
            false,
        ),
        (
            "comment end inside",
            doc(&KANBAN.replace("1.2.0", "1.2.0*/"), "x"),
            Some(KANBAN.replace("1.2.0", "1.2.0*/")),
            "x".into(),
            false,
        ),
        (
            "bad app id",
            doc(&KANBAN.replace("com.acme.kanban", "Kanban"), "x"),
            Some(KANBAN.replace("com.acme.kanban", "Kanban")),
            "x".into(),
            false,
        ),
        (
            "unknown field",
            doc(
                &KANBAN.replace("\"surface\"", "\"grant\":1,\"surface\""),
                "x",
            ),
            Some(KANBAN.replace("\"surface\"", "\"grant\":1,\"surface\"")),
            "x".into(),
            false,
        ),
    ]
}

/// What `join(split(content))` gives: `content` itself, except that a document that is only a
/// header gains the newline every header is followed by.
fn joined(content: &str) -> String {
    match split(content) {
        (Some(header), "") if header == content => format!("{content}\n"),
        _ => content.to_string(),
    }
}

#[test]
fn every_case_splits_joins_and_reads_as_recorded() {
    for (name, content, header, body, reads) in cases() {
        let (found, rest) = split(&content);
        assert_eq!(found.map(str::to_string), header, "{name}: header");
        assert_eq!(rest, body, "{name}: body");
        assert_eq!(
            join(found, rest),
            joined(&content),
            "{name}: join undoes split"
        );
        assert_eq!(read_document(&content).is_ok(), reads, "{name}: reads");
    }
}

#[test]
fn the_cases_are_exported_for_the_ui_drift_test() {
    let cases: Vec<serde_json::Value> = cases()
        .into_iter()
        .map(|(name, content, header, body, reads)| {
            let joined = joined(&content);
            serde_json::json!({ "name": name, "content": content, "header": header, "body": body, "joined": joined, "valid": reads })
        })
        .collect();
    let text = serde_json::to_string_pretty(&cases).expect("serialises") + "\n";
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("bindings/md-header-fixtures.json");
    std::fs::write(&path, text).expect("write bindings/md-header-fixtures.json");
}
