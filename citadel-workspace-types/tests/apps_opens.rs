//! `opens`: the files an app opens. Accepted in the one canonical form with a surface the app
//! paints and an explicit size ceiling; every other form refused, on its own. Citadel Docs is built
//! into the page, so its declaration is a committed `FileOpens` checked here by the same rule.

use citadel_workspace_types::apps_manifest::AppSurface;
use citadel_workspace_types::apps_opens::{
    opens_problem, FileOpens, MAX_EXTENSION_CHARS, MAX_OPENS_EXTENSIONS, MAX_OPEN_FILE_BYTES,
};
use std::path::Path;

fn opens(extensions: &[&str]) -> FileOpens {
    FileOpens {
        extensions: extensions.iter().map(|e| e.to_string()).collect(),
        surface: AppSurface::NodeTab,
        max_bytes: 1024,
    }
}

fn refused(o: &FileOpens) -> String {
    opens_problem(o, &[AppSurface::NodeTab]).expect("refused")
}

#[test]
fn the_canonical_form_is_accepted() {
    assert_eq!(
        opens_problem(&opens(&["ics", "md", "7z"]), &[AppSurface::NodeTab]),
        None
    );
    let longest = "a".repeat(MAX_EXTENSION_CHARS);
    assert_eq!(
        opens_problem(&opens(&[longest.as_str()]), &[AppSurface::NodeTab]),
        None
    );
    let most: Vec<String> = (0..MAX_OPENS_EXTENSIONS).map(|i| format!("x{i}")).collect();
    let most: Vec<&str> = most.iter().map(String::as_str).collect();
    assert_eq!(opens_problem(&opens(&most), &[AppSurface::NodeTab]), None);
}

#[test]
fn each_malformed_extension_is_refused() {
    assert!(refused(&opens(&[])).contains("0 extensions"));
    assert!(refused(&opens(&[""])).contains("empty"));
    assert!(refused(&opens(&[".md"])).contains("starts with a dot"));
    assert!(refused(&opens(&["DOCX"])).contains("not lower-case"));
    assert!(refused(&opens(&["md", "md"])).contains("listed twice"));
    let long = "a".repeat(MAX_EXTENSION_CHARS + 1);
    assert!(refused(&opens(&[long.as_str()])).contains("longer than"));
    for bad in [
        "tar.gz", "md/..", "a/b", "a\\b", "m d", "mdé", "m-d", "md\u{0}",
    ] {
        assert!(
            refused(&opens(&[bad])).contains("other than a-z and 0-9"),
            "{bad}"
        );
    }
    let many: Vec<String> = (0..=MAX_OPENS_EXTENSIONS)
        .map(|i| format!("x{i}"))
        .collect();
    let many: Vec<&str> = many.iter().map(String::as_str).collect();
    assert!(refused(&opens(&many)).contains("extensions, not 1 to"));
}

#[test]
fn opening_files_with_no_surface_to_show_them_is_refused() {
    let why = opens_problem(&opens(&["ics"]), &[AppSurface::CanvasPane]).expect("refused");
    assert!(why.contains("not one the app paints"), "{why}");
    assert!(opens_problem(&opens(&["ics"]), &[]).is_some());
}

#[test]
fn the_size_ceiling_is_explicit_and_bounded() {
    let mut o = opens(&["ics"]);
    o.max_bytes = 0;
    assert!(refused(&o).contains("max_bytes"));
    o.max_bytes = MAX_OPEN_FILE_BYTES + 1;
    assert!(refused(&o).contains("max_bytes"));
    o.max_bytes = MAX_OPEN_FILE_BYTES;
    assert_eq!(opens_problem(&o, &[AppSurface::NodeTab]), None);
}

#[test]
fn citadel_docs_declaration_reads_and_stands() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../citadel-workspaces/src/lib/citadel-apps/first-party/docs.opens.json");
    let bytes = std::fs::read(&path).expect("docs.opens.json");
    let declared: FileOpens = serde_json::from_slice(&bytes).expect("a FileOpens");
    // Docs' file screen is its editor region: the one surface a built-in Docs paints.
    assert_eq!(opens_problem(&declared, &[AppSurface::CanvasPane]), None);
}
