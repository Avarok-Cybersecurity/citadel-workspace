// Deciding whether a checked-out submodule is the one the build expects.
//
// Four repositories build one product, and three of them are submodules. A
// stale one does not fail: it compiles, links and runs, and reports results
// from code nobody is looking at. Two rounds were spent this week on failures
// that turned on which submodule commit was actually present, and the answer
// was never on screen.
//
// `build.rs` runs this on every `cargo build`, so the answer is on screen
// before anything else happens. The classification lives here rather than in
// the build script so it can be tested: a build script is not a test target,
// and a rule that cannot be tested is a rule that is asserted rather than
// known. `build.rs` pulls it in with `include!`.
//
// What counts as wrong is deliberately narrow, because the everyday workflow
// for this repository is to commit INSIDE a submodule and update the parent's
// pointer afterwards. That state — checked out ahead of the pointer — is
// correct work in progress, and failing it would train everyone to set the
// escape hatch permanently. Only two states are actually wrong:
//
//   - not initialised: the directory is empty, and whatever the build produces
//     is not built from the code the pointer names;
//   - BEHIND the pointer: the checked-out commit is an ancestor of the one
//     recorded, so the build is using an older submodule than this commit of
//     the parent asks for. That is "not the latest", exactly.
//
// Ahead, or diverged onto another branch, is left alone with a note.

/// What `git submodule status` says about one submodule, before ancestry is known.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Marker {
    /// Checked out at exactly the recorded pointer.
    Current,
    /// Checked out at a DIFFERENT commit than the pointer records.
    Differs,
    /// Not initialised — the directory is empty.
    Uninitialised,
    /// A merge conflict inside the submodule.
    Conflicted,
}

/// One parsed line of `git submodule status --recursive`.
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct Entry {
    pub marker: Marker,
    /// The commit actually checked out.
    pub checked_out: String,
    pub path: String,
}

/// Parse one status line.
///
/// The format is a one-character marker, then the SHA of the commit that is
/// CHECKED OUT (not the recorded pointer), then the path, then an optional
/// `(describe)`. A line whose marker is a space carries a leading space, so the
/// marker cannot be found by trimming first — that is how a first attempt at
/// this read every clean submodule as `Uninitialised`.
pub fn parse_line(line: &str) -> Option<Entry> {
    let mut chars = line.chars();
    let marker = match chars.next()? {
        ' ' => Marker::Current,
        '+' => Marker::Differs,
        '-' => Marker::Uninitialised,
        'U' => Marker::Conflicted,
        // Not a status line at all.
        _ => return None,
    };
    let rest: &str = chars.as_str();
    let mut fields = rest.split_whitespace();
    let checked_out: String = fields.next()?.to_string();
    let path: String = fields.next()?.to_string();
    if checked_out.is_empty() || path.is_empty() {
        return None;
    }
    Some(Entry {
        marker,
        checked_out,
        path,
    })
}

/// Whether the checked-out commit is an ancestor of the recorded pointer.
///
/// Only asked for `Differs`, and only answerable by git, so it is supplied
/// rather than computed here — which is what makes the verdict testable.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Ancestry {
    /// Checked out is an ancestor of the pointer: the submodule is BEHIND.
    Behind,
    /// Anything else — ahead, diverged, or unknowable.
    NotBehind,
}

/// The verdict for one submodule.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Verdict {
    Fine,
    /// Say so, but do not fail: this is ordinary work in progress.
    AheadOrDiverged,
    Behind,
    Uninitialised,
    Conflicted,
}

/// Combine the marker with the ancestry answer.
pub fn verdict(marker: Marker, ancestry: Option<Ancestry>) -> Verdict {
    match marker {
        Marker::Current => Verdict::Fine,
        Marker::Uninitialised => Verdict::Uninitialised,
        Marker::Conflicted => Verdict::Conflicted,
        Marker::Differs => match ancestry {
            Some(Ancestry::Behind) => Verdict::Behind,
            // No answer is NOT an accusation. If git could not decide the
            // ancestry -- a shallow clone, a missing object -- the honest
            // verdict is the permissive one, said out loud.
            Some(Ancestry::NotBehind) | None => Verdict::AheadOrDiverged,
        },
    }
}

/// Whether a verdict should stop the build.
pub fn is_fatal(v: Verdict) -> bool {
    matches!(
        v,
        Verdict::Behind | Verdict::Uninitialised | Verdict::Conflicted
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_clean_submodule_line_keeps_its_leading_space() {
        // The marker is column 0 and a clean entry's marker IS a space. Trimming
        // the line before reading it turns every clean submodule into
        // `Uninitialised`, because '-' is what a trimmed line's first char would
        // never be but ' ' is what it loses.
        let e = parse_line(" 7e4cdf7ce578 citadel-internal-service (remotes/origin/x)").unwrap();
        assert_eq!(e.marker, Marker::Current);
        assert_eq!(e.checked_out, "7e4cdf7ce578");
        assert_eq!(e.path, "citadel-internal-service");
    }

    #[test]
    fn the_three_dirty_markers_are_distinguished() {
        assert_eq!(parse_line("+abc123 sub").unwrap().marker, Marker::Differs);
        assert_eq!(
            parse_line("-abc123 sub").unwrap().marker,
            Marker::Uninitialised
        );
        assert_eq!(
            parse_line("Uabc123 sub").unwrap().marker,
            Marker::Conflicted
        );
    }

    #[test]
    fn a_line_that_is_not_a_status_line_is_not_invented_into_one() {
        assert!(parse_line("").is_none());
        assert!(parse_line("fatal: not a git repository").is_none());
        assert!(parse_line(" only-one-field").is_none());
    }

    #[test]
    fn behind_is_fatal_and_ahead_is_not() {
        assert_eq!(
            verdict(Marker::Differs, Some(Ancestry::Behind)),
            Verdict::Behind
        );
        assert!(is_fatal(Verdict::Behind));

        // The everyday workflow: commit inside the submodule, update the parent
        // pointer afterwards. Failing this would make the escape hatch permanent.
        assert_eq!(
            verdict(Marker::Differs, Some(Ancestry::NotBehind)),
            Verdict::AheadOrDiverged
        );
        assert!(!is_fatal(Verdict::AheadOrDiverged));
    }

    #[test]
    fn an_unanswerable_ancestry_does_not_become_an_accusation() {
        assert_eq!(verdict(Marker::Differs, None), Verdict::AheadOrDiverged);
        assert!(!is_fatal(Verdict::AheadOrDiverged));
    }

    #[test]
    fn an_empty_submodule_stops_the_build() {
        assert!(is_fatal(verdict(Marker::Uninitialised, None)));
        assert!(is_fatal(verdict(Marker::Conflicted, None)));
        assert!(!is_fatal(verdict(Marker::Current, None)));
    }
}
