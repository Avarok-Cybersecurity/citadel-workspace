//! The required-apps header: one strict line, refused in every other form, written in one
//! canonical form. How documents split and join is `apps_md_header_cases`.

mod apps_fixture;

use apps_fixture::md::{requirement, KANBAN, TWO};
use citadel_workspace_types::apps_md_header::{
    parse_header, render_header, AppsHeader, HeaderRefusal as R, MAX_HEADER_BYTES, MAX_REQUIREMENTS,
};

#[test]
fn a_header_parses_and_renders_byte_for_byte() {
    let header = parse_header(TWO).expect("the two-app header");
    assert_eq!(
        header.require,
        vec![
            requirement("com.acme.kanban", "1.2.0"),
            requirement("com.acme.lint", "0.9.0")
        ]
    );
    assert_eq!(render_header(&header).unwrap(), TWO);
}

#[test]
fn each_malformed_header_names_its_fault() {
    for (line, fault) in [
        (KANBAN.replace("{/* ", "{/*"), R::Shape),
        (KANBAN.replace(" */}", "*/}"), R::Shape),
        (KANBAN.replace("apps 1 ", "apps 2 "), R::Version),
        (KANBAN.replace("1.2.0", "1.2.0*/"), R::CommentTerminator),
        (KANBAN.replace("[{", "[ {"), R::NotCanonical),
        (TWO.replace("kanban", "zzz"), R::NotCanonical),
        (
            format!("{{/* @citadel-apps 1 {} */}}", r#"{"require":[]}"#),
            R::Empty,
        ),
        (KANBAN.replace("com.acme.kanban", "Kanban"), R::AppId),
        (KANBAN.replace("1.2.0", "1.2"), R::MinVersion),
        (
            KANBAN.replace("\"none\"", "\"zone\""),
            R::Json(String::new()),
        ),
        (
            format!("{KANBAN}{}", " ".repeat(MAX_HEADER_BYTES)),
            R::TooLarge,
        ),
    ] {
        let got = parse_header(&line);
        match (&got, &fault) {
            (Err(R::Json(_)), R::Json(_)) => {}
            _ => assert_eq!(got, Err(fault.clone()), "{line}"),
        }
    }
}

#[test]
fn normalising_keeps_the_higher_minimum_once_and_sorts() {
    let header = AppsHeader::normalized([
        requirement("com.acme.lint", "0.9.0"),
        requirement("com.acme.kanban", "1.2.0"),
        requirement("com.acme.kanban", "1.10.0"),
        requirement("com.acme.kanban", "1.3.0"),
    ]);
    assert_eq!(
        header.require,
        vec![
            requirement("com.acme.kanban", "1.10.0"),
            requirement("com.acme.lint", "0.9.0")
        ]
    );
    assert!(render_header(&header).is_ok());
    // Control: the same entries, not normalised, are refused.
    let raw = AppsHeader {
        require: vec![
            requirement("com.acme.lint", "0.9.0"),
            requirement("com.acme.kanban", "1.2.0"),
        ],
    };
    assert_eq!(render_header(&raw), Err(R::NotCanonical));
}

#[test]
fn too_many_requirements_are_refused() {
    let many = |n: usize| {
        AppsHeader::normalized((0..n).map(|i| requirement(&format!("com.acme.app{i:03}"), "1.0.0")))
    };
    assert!(render_header(&many(MAX_REQUIREMENTS)).is_ok());
    assert_eq!(render_header(&many(MAX_REQUIREMENTS + 1)), Err(R::TooMany));
}
