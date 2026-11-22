use super::safety::{judge, DirFacts, Unsafe};
use std::path::{Path, PathBuf};

const DIR: DirFacts = DirFacts {
    is_symlink: false,
    is_dir: true,
};

fn home() -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(r"C:\Users\a")
    } else {
        PathBuf::from("/home/a")
    }
}

fn root() -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(r"C:\")
    } else {
        PathBuf::from("/")
    }
}

fn data() -> PathBuf {
    home().join(".citadel-agent")
}

fn judged(target: &Path, configured: &Path, facts: DirFacts) -> Result<(), Unsafe> {
    judge(target, configured, Some(&home()), &facts)
}

#[test]
fn the_configured_data_directory_may_go() {
    assert_eq!(judged(&data(), &data(), DIR), Ok(()));
    // A directory configured outside home (INTERNAL_SERVICE_DATA_DIR) may go too.
    let elsewhere = root().join("srv").join("citadel");
    assert_eq!(judged(&elsewhere, &elsewhere, DIR), Ok(()));
}

#[test]
fn home_is_refused() {
    assert_eq!(judged(&home(), &home(), DIR), Err(Unsafe::Home));
}

#[test]
fn root_is_refused() {
    assert_eq!(judged(&root(), &root(), DIR), Err(Unsafe::Root));
}

#[test]
fn a_parent_of_home_is_refused() {
    let parent = home().parent().unwrap().to_path_buf();
    assert_eq!(judged(&parent, &parent, DIR), Err(Unsafe::ContainsHome));
}

#[test]
fn a_symlink_is_refused() {
    let link = DirFacts {
        is_symlink: true,
        is_dir: false,
    };
    assert_eq!(judged(&data(), &data(), link), Err(Unsafe::Symlink));
}

#[test]
fn a_file_is_refused() {
    let file = DirFacts {
        is_symlink: false,
        is_dir: false,
    };
    assert_eq!(judged(&data(), &data(), file), Err(Unsafe::NotADirectory));
}

#[test]
fn anything_but_the_configured_directory_is_refused() {
    let other = home().join("Documents");
    assert_eq!(
        judged(&other, &data(), DIR),
        Err(Unsafe::NotTheConfiguredDir)
    );
    let inside = data().join("accounts");
    assert_eq!(
        judged(&inside, &data(), DIR),
        Err(Unsafe::NotTheConfiguredDir)
    );
}

#[test]
fn relative_and_dotted_paths_are_refused() {
    let relative = PathBuf::from(".citadel-agent");
    assert_eq!(judged(&relative, &relative, DIR), Err(Unsafe::NotAbsolute));
    let dotted = data().join("..");
    assert_eq!(judged(&dotted, &dotted, DIR), Err(Unsafe::NotNormal));
}

/// The facts come from the filesystem without following links.
#[cfg(unix)]
#[test]
fn a_real_symlink_reads_as_one() {
    let tmp = tempfile::tempdir().unwrap();
    let real = tmp.path().join("real");
    std::fs::create_dir(&real).unwrap();
    let link = tmp.path().join("link");
    std::os::unix::fs::symlink(&real, &link).unwrap();
    assert!(DirFacts::of(&link).unwrap().is_symlink);
    assert_eq!(DirFacts::of(&real).unwrap(), DIR);
}
