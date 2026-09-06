use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

// The pure half of the submodule rule, shared with the crate so it has tests.
// A build script is not a test target; logic that lives only here is asserted
// rather than known.
include!("src/submodule_freshness.rs");
include!("src/dependency_agreement.rs");

fn main() {
    let manifest: PathBuf = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let workspace_root: &Path = manifest.parent().unwrap();

    let submodule_paths: Vec<String> = check_submodules(workspace_root);
    check_dependency_agreement(workspace_root, &submodule_paths);

    // Get the output directory for TypeScript types
    let out_dir = workspace_root
        .join("citadel-workspace-client-ts")
        .join("src")
        .join("types");

    // Create the directory if it doesn't exist
    std::fs::create_dir_all(&out_dir).unwrap();

    // Set the TS_RS_EXPORT_DIR environment variable
    env::set_var("TS_RS_EXPORT_DIR", out_dir.to_str().unwrap());

    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=src/structs.rs");
    println!("cargo:rerun-if-changed=src/submodule_freshness.rs");
    // The recorded pointers, so a `git submodule update` re-runs this check
    // rather than leaving the previous verdict cached for the rest of the day.
    println!("cargo:rerun-if-changed=../.gitmodules");
    // Both lock files, so a `cargo update` in either workspace re-runs the
    // agreement check rather than leaving yesterday's verdict cached.
    println!("cargo:rerun-if-changed=../Cargo.lock");
    println!("cargo:rerun-if-changed=../citadel-internal-service/Cargo.lock");
    println!("cargo:rerun-if-changed=src/dependency_agreement.rs");
}

/// Refuse to build against a submodule that is not the one this commit names.
///
/// Every crate in the workspace depends on `citadel-workspace-types`, so this is
/// the earliest point at which any `cargo build` here can speak — and a stale
/// submodule does not announce itself: it compiles, links, runs, and reports
/// results from code nobody is looking at.
///
/// Three ways this stays out of the way:
///
///   - No network. `git fetch` in a build script would make every offline build
///     hang or fail, and "latest" here means the commit THIS parent commit
///     records, which is answerable locally.
///   - Ahead is fine. Committing inside a submodule and updating the pointer
///     afterwards is the documented workflow (CLAUDE.md, bottom-up commit
///     order); failing it would make the escape hatch permanent.
///   - Missing git is not a failure. The Docker images copy specific crates and
///     no `.git`, exactly as the WASM build script already handles — a check
///     that only works in one of the two places it runs is worse than none.
///
/// `SKIP_SUBMODULE_CHECK=1` opts out, spelled like the `SKIP_WASM_BUILD` beside
/// it.
fn check_submodules(workspace_root: &Path) -> Vec<String> {
    if env::var("SKIP_SUBMODULE_CHECK").is_ok() {
        println!("cargo:warning=SKIP_SUBMODULE_CHECK set; submodule freshness was not checked.");
        return Vec::new();
    }
    if !workspace_root.join(".git").exists() {
        // A partial checkout: nothing to compare against, and saying so beats
        // guessing. Not a warning — this is the normal case inside Docker, and a
        // warning on every image build is noise that trains people to skim.
        return Vec::new();
    }

    let status = match Command::new("git")
        .args(["submodule", "status", "--recursive"])
        .current_dir(workspace_root)
        .output()
    {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).into_owned(),
        // git absent, or this is not a work tree. Same reasoning as above.
        _ => return Vec::new(),
    };

    let mut fatal: Vec<String> = Vec::new();
    let mut paths: Vec<String> = Vec::new();

    for line in status.lines() {
        let Some(entry) = parse_line(line) else {
            continue;
        };
        paths.push(entry.path.clone());

        let ancestry: Option<Ancestry> = if entry.marker == Marker::Differs {
            recorded_pointer(workspace_root, &entry.path).and_then(|pointer| {
                ancestry_of(workspace_root, &entry.path, &entry.checked_out, &pointer)
            })
        } else {
            None
        };

        match verdict(entry.marker, ancestry) {
            Verdict::Fine => {}
            Verdict::AheadOrDiverged => {
                println!(
                    "cargo:warning={} is checked out at {} rather than the recorded pointer. \
                     Not stale — update the parent's pointer when you are done.",
                    entry.path, entry.checked_out,
                );
            }
            Verdict::Behind => fatal.push(format!(
                "{} is BEHIND: checked out at {}, which is an ancestor of the commit this \
                 parent commit records. The build would use older submodule code than this \
                 tree asks for.",
                entry.path, entry.checked_out,
            )),
            Verdict::Uninitialised => fatal.push(format!(
                "{} is not initialised — the directory is empty.",
                entry.path,
            )),
            Verdict::Conflicted => {
                fatal.push(format!("{} has an unresolved merge conflict.", entry.path,))
            }
        }
    }

    if !fatal.is_empty() {
        for problem in &fatal {
            println!("cargo:warning={problem}");
        }
        panic!(
            "\n\n{} submodule(s) are not the ones this commit names:\n  {}\n\n\
             Run:  git submodule update --init --recursive\n\n\
             A stale submodule does not fail — it compiles and runs, and reports results \
             from code nobody is looking at. Set SKIP_SUBMODULE_CHECK=1 to build anyway.\n",
            fatal.len(),
            fatal.join("\n  "),
        );
    }

    paths
}

/// Every repository here must build against the SAME revision of a shared git
/// dependency.
///
/// The parent and the agent are separate cargo workspaces with separate lock
/// files. `cargo update citadel_sdk` in one and not the other compiles cleanly
/// in both and fails at runtime -- CLAUDE.md records the symptoms, and none of
/// them is a compile error: "rekey timeouts, P2P connection hangs, protocol
/// errors".
///
/// Recursive by construction: the lock files come from the submodule list this
/// build script already walked, so a fourth repository is covered by being a
/// submodule rather than by an edit here. A hand-written list of lock files
/// would be one more thing to drift, which is the defect this file is guarding
/// against in the first place.
///
/// Missing lock files are skipped, not reported. The Docker images copy
/// specific crates; a check that only works in one of the two places it runs is
/// worse than none.
fn check_dependency_agreement(workspace_root: &Path, submodule_paths: &[String]) {
    if env::var("SKIP_SUBMODULE_CHECK").is_ok() {
        return;
    }

    let mut locks: Vec<(String, Vec<GitPackage>)> = Vec::new();
    let mut candidates: Vec<(String, PathBuf)> =
        vec![("parent".to_string(), workspace_root.join("Cargo.lock"))];
    for path in submodule_paths {
        candidates.push((path.clone(), workspace_root.join(path).join("Cargo.lock")));
    }

    for (label, file) in candidates {
        let Ok(text) = std::fs::read_to_string(&file) else {
            continue;
        };
        locks.push((label, parse_git_packages(&text)));
    }

    // One lock file compares against nothing. Say so rather than reporting
    // agreement: "no disagreements found" over a single input is the shape of a
    // check that cannot fail.
    if locks.len() < 2 {
        return;
    }

    let found: Vec<Disagreement> = disagreements(&locks);
    if found.is_empty() {
        return;
    }

    let mut lines: Vec<String> = Vec::new();
    for d in &found {
        let pins: Vec<String> = d
            .pins
            .iter()
            .map(|(label, rev)| format!("{label} -> {rev}"))
            .collect();
        lines.push(format!(
            "{} ({}): {}",
            d.name,
            d.repository,
            pins.join(", ")
        ));
    }
    for line in &lines {
        println!("cargo:warning={line}");
    }
    panic!(
        "\n\n{} shared git dependenc(ies) are pinned to different revisions across these \
         workspaces:\n  {}\n\n\
         Update every workspace together. From the repository root:\n\
         \x20 cargo update <crate> && (cd citadel-internal-service && cargo update <crate>)\n\n\
         This compiles cleanly either way and fails at runtime -- rekey timeouts, P2P \
         connection hangs, protocol errors. Set SKIP_SUBMODULE_CHECK=1 to build anyway.\n",
        found.len(),
        lines.join("\n  "),
    );
}

/// The commit recorded for a submodule path, by whichever repository records it.
///
/// Not always the parent. `--recursive` reports NESTED submodules too, and
/// `intersession-layer-messaging` is recorded by the AGENT's tree, not by this
/// one: `git rev-parse HEAD:citadel-internal-service/intersession-layer-messaging`
/// run here fails, because that path does not exist in this repository's tree at
/// all. Unfixed, every nested submodule resolved to "no pointer" and could never
/// be found stale -- the recursion would have been decorative.
///
/// So the question is asked of the directory that CONTAINS the submodule, using
/// the name relative to it. That is uniform: for a top-level submodule the
/// container is the workspace root and the relative name is the whole path.
fn recorded_pointer(root: &Path, path: &str) -> Option<String> {
    let (container, name): (PathBuf, &str) = match path.rsplit_once('/') {
        Some((parent, leaf)) => (root.join(parent), leaf),
        None => (root.to_path_buf(), path),
    };
    let out = Command::new("git")
        .args(["rev-parse", &format!("HEAD:{name}")])
        .current_dir(&container)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let sha: String = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if sha.is_empty() {
        None
    } else {
        Some(sha)
    }
}

/// Whether `checked_out` is an ancestor of `pointer`, asked inside the submodule.
///
/// `None` when git cannot say — a shallow clone, a missing object. The verdict
/// treats that as permissive rather than as an accusation.
fn ancestry_of(root: &Path, path: &str, checked_out: &str, pointer: &str) -> Option<Ancestry> {
    // INSIDE the submodule. Both SHAs name commits in the submodule's history,
    // which the parent repository does not have -- run there and `merge-base`
    // exits 128 with "Not a valid object name", the verdict falls through to
    // "could not decide", and a submodule three commits behind builds happily.
    // That is what the first version of this did, and its negative control
    // passed green.
    let out = Command::new("git")
        .args(["merge-base", "--is-ancestor", checked_out, pointer])
        .current_dir(root.join(path))
        .output()
        .ok()?;
    // Exit 0 = ancestor, 1 = not, anything else = could not decide.
    match out.status.code() {
        Some(0) => Some(Ancestry::Behind),
        Some(1) => Some(Ancestry::NotBehind),
        _ => None,
    }
}
