//! Test-only: what a redacted line says outside its placeholders.

/// `line` with every `<kind:digits>` placeholder removed. A placeholder's digits come from the
/// batch's random salt, so they can spell a redacted value by chance (`<host:317048808656>`
/// contains Bob's `8808`); a leak check must look only at the text around them.
pub(super) fn outside_placeholders(line: &str) -> String {
    line.split('<')
        .map(|part| part.split_once('>').map_or(part, |(_, rest)| rest))
        .collect()
}

#[test]
fn a_value_inside_a_placeholder_is_not_outside_it() {
    let line = "8808 lost <host:317048808656> twice";
    assert_eq!(outside_placeholders(line), "8808 lost  twice");
    assert!(!outside_placeholders("lost <host:317048808656>").contains("8808"));
}
