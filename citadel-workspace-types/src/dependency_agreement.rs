// Whether the repositories that build one product agree on what they build against.
//
// The submodule check answers "is this the commit the parent names". It cannot
// answer the other half, and the other half has bitten this repository before:
// the parent workspace and the agent workspace are SEPARATE cargo workspaces
// with SEPARATE lock files, and both depend on the same git crates. Update
// `citadel_sdk` in one and not the other and everything still compiles --
// CLAUDE.md records what happens next, and it is not a compile error: "rekey
// timeouts, P2P connection hangs, protocol errors".
//
// So: any git-sourced package that appears in more than one lock file must
// resolve to the same revision in all of them. Version-equivalence, alongside
// commit-freshness.
//
// Only GIT sources. A registry crate at two versions is ordinary and cargo
// unifies semver-compatible ones itself; a git crate is pinned by revision, and
// two revisions of one protocol crate in one running system is the failure this
// exists for.
//
// Pure, and separated from the file reading, so it has tests. `build.rs` is not
// a test target.

/// One git-sourced package as a lock file records it.
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct GitPackage {
    pub name: String,
    /// The pinned revision — the fragment after `#` in the source URL.
    pub revision: String,
    /// The repository, without the fragment. Two packages of the same name from
    /// DIFFERENT repositories are not a disagreement about a revision.
    pub repository: String,
}

/// Every git-sourced package in a `Cargo.lock`.
///
/// Split on `[[package]]` rather than parsed as TOML: a build script that pulls
/// in a TOML parser makes every crate in the workspace wait for it to compile,
/// and the shape being read here is two fixed keys.
pub fn parse_git_packages(lock: &str) -> Vec<GitPackage> {
    let mut found: Vec<GitPackage> = Vec::new();
    for block in lock.split("[[package]]") {
        let mut name: Option<&str> = None;
        let mut source: Option<&str> = None;
        for line in block.lines() {
            let line: &str = line.trim();
            if let Some(rest) = line.strip_prefix("name = \"") {
                name = rest.strip_suffix('"');
            } else if let Some(rest) = line.strip_prefix("source = \"") {
                source = rest.strip_suffix('"');
            }
        }
        let (Some(name), Some(source)) = (name, source) else {
            continue;
        };
        let Some(git) = source.strip_prefix("git+") else {
            continue;
        };
        // No fragment means no pinned revision to compare.
        let Some((repository, revision)) = git.split_once('#') else {
            continue;
        };
        found.push(GitPackage {
            name: name.to_string(),
            revision: revision.to_string(),
            // The query string carries `?branch=`/`?rev=`, which is how the
            // pin was REQUESTED. What matters is what it resolved to, and two
            // lock files may spell the request differently while resolving the
            // same. Compare the repository and the resolved revision only.
            repository: repository
                .split('?')
                .next()
                .unwrap_or(repository)
                .to_string(),
        });
    }
    found
}

/// One package pinned to different revisions by different lock files.
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct Disagreement {
    pub name: String,
    pub repository: String,
    /// `(lock file label, revision)`, sorted by label.
    pub pins: Vec<(String, String)>,
}

/// Packages that more than one lock file pins, differently.
///
/// Takes `(label, packages)` pairs so the caller names the lock files however it
/// found them, and so this can be driven from a fixture in a test.
pub fn disagreements(locks: &[(String, Vec<GitPackage>)]) -> Vec<Disagreement> {
    use std::collections::BTreeMap;
    // (name, repository) -> label -> revision
    let mut seen: BTreeMap<(String, String), BTreeMap<String, String>> = BTreeMap::new();
    for (label, packages) in locks {
        for p in packages {
            seen.entry((p.name.clone(), p.repository.clone()))
                .or_default()
                .insert(label.clone(), p.revision.clone());
        }
    }
    seen.into_iter()
        .filter_map(|((name, repository), pins)| {
            let distinct: std::collections::BTreeSet<&String> = pins.values().collect();
            if pins.len() < 2 || distinct.len() < 2 {
                return None;
            }
            Some(Disagreement {
                name,
                repository,
                pins: pins.into_iter().collect(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const PARENT: &str = r#"
[[package]]
name = "citadel_sdk"
version = "0.13.0"
source = "git+https://github.com/Avarok-Cybersecurity/Citadel-Protocol?branch=master#3493f51b"

[[package]]
name = "serde"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
"#;

    #[test]
    fn only_git_sources_are_collected() {
        let packages = parse_git_packages(PARENT);
        assert_eq!(
            packages.len(),
            1,
            "the registry crate is not a pinned revision"
        );
        assert_eq!(packages[0].name, "citadel_sdk");
        assert_eq!(packages[0].revision, "3493f51b");
        assert!(
            !packages[0].repository.contains('?'),
            "the query string is how the pin was REQUESTED, not what it resolved to"
        );
    }

    #[test]
    fn the_same_revision_spelled_two_ways_is_not_a_disagreement() {
        // One lock file asks by branch, the other by rev; both resolved to the
        // same commit. Comparing the raw source strings would call this a
        // conflict and send someone updating a dependency that is already right.
        let a = parse_git_packages(PARENT);
        let b = parse_git_packages(&PARENT.replace("?branch=master", "?rev=3493f51b"));
        let found = disagreements(&[("parent".into(), a), ("agent".into(), b)]);
        assert!(found.is_empty(), "{found:?}");
    }

    #[test]
    fn two_revisions_of_one_crate_are_reported() {
        let a = parse_git_packages(PARENT);
        let b = parse_git_packages(&PARENT.replace("3493f51b", "deadbeef"));
        let found = disagreements(&[("parent".into(), a), ("agent".into(), b)]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "citadel_sdk");
        assert_eq!(
            found[0].pins,
            vec![
                ("agent".to_string(), "deadbeef".to_string()),
                ("parent".to_string(), "3493f51b".to_string())
            ],
        );
    }

    #[test]
    fn a_crate_only_one_lock_file_has_is_not_a_disagreement() {
        // Otherwise every crate unique to one workspace would be reported, and a
        // check that fires on the normal case gets switched off.
        let a = parse_git_packages(PARENT);
        let found = disagreements(&[("parent".into(), a), ("agent".into(), Vec::new())]);
        assert!(found.is_empty());
    }

    #[test]
    fn same_name_from_different_repositories_is_not_a_disagreement() {
        // A fork and its upstream share a crate name and are genuinely two
        // different dependencies.
        let a = parse_git_packages(PARENT);
        let b = parse_git_packages(
            &PARENT
                .replace("Avarok-Cybersecurity/Citadel-Protocol", "someone/fork")
                .replace("3493f51b", "deadbeef"),
        );
        assert!(disagreements(&[("parent".into(), a), ("agent".into(), b)]).is_empty());
    }
}
