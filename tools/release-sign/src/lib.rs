//! `release-sign`: the ML-DSA-65 key, signatures and checks for Citadel agent release assets.
//!
//! ```text
//! release-sign keygen    --private-key <new file> [--public-key <file>]
//! release-sign sign      --private-key <file> --tag <agent-vX.Y.Z> <asset>...
//! release-sign verify    --public-key <file>  --tag <agent-vX.Y.Z> <asset>...
//! release-sign check-key --public-key <file>
//! ```
//!
//! What is signed is `citadel_release_signature`'s (the agent repository), the one definition the
//! updater checks against:
//!
//! ```text
//! b"citadel-agent-release-v1\0" || tag || b"\0" || asset_name || b"\0" || sha256(asset)
//! ```
//!
//! `asset_name` is the file's name (its last path component). `sign` writes
//! `<asset>.mldsa.sig` beside each asset: the 3309-byte signature in lowercase hex and a newline.
//!
//! The private key file is the 32-byte ML-DSA seed as 64 lowercase hex characters and a newline
//! (whitespace around it is ignored when read). `keygen` creates it with mode 0600 and refuses to
//! overwrite a file; it prints only the public key: 3904 hex characters on one line, which is
//! public and safe to print. `--public-key` also writes that line to a file (the agent's
//! `updater/release_public_key.txt`).
//!
//! This module parses and decides; main.rs does the file I/O.

use citadel_release_signature::{Refusal, ReleaseSigningKey, SIGNATURE_SUFFIX};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Keygen {
        private_key: PathBuf,
        public_key: Option<PathBuf>,
    },
    Sign {
        private_key: PathBuf,
        tag: String,
        assets: Vec<PathBuf>,
    },
    Verify {
        public_key: PathBuf,
        tag: String,
        assets: Vec<PathBuf>,
    },
    CheckKey {
        public_key: PathBuf,
    },
}

pub const USAGE: &str = "usage:
  release-sign keygen    --private-key <new file> [--public-key <file>]
  release-sign sign      --private-key <file> --tag <tag> <asset>...
  release-sign verify    --public-key <file>  --tag <tag> <asset>...
  release-sign check-key --public-key <file>";

pub fn parse(args: &[String]) -> Result<Command, String> {
    let (command, rest) = args.split_first().ok_or("no command")?;
    let mut private_key = None;
    let mut public_key = None;
    let mut tag = None;
    let mut assets = Vec::new();
    let mut rest = rest.iter();
    while let Some(arg) = rest.next() {
        let mut value = |flag: &str| {
            rest.next()
                .cloned()
                .ok_or_else(|| format!("{flag} needs a value"))
        };
        match arg.as_str() {
            "--private-key" => private_key = Some(PathBuf::from(value(arg)?)),
            "--public-key" => public_key = Some(PathBuf::from(value(arg)?)),
            "--tag" => tag = Some(value(arg)?),
            flag if flag.starts_with("--") => return Err(format!("unknown flag {flag}")),
            asset => assets.push(PathBuf::from(asset)),
        }
    }
    let need = |v: Option<PathBuf>, flag: &str| v.ok_or_else(|| format!("{command} needs {flag}"));
    let need_tag = |v: Option<String>| v.ok_or_else(|| format!("{command} needs --tag"));
    let need_assets = |assets: Vec<PathBuf>| {
        if assets.is_empty() {
            Err(format!("{command} needs at least one asset"))
        } else {
            Ok(assets)
        }
    };
    let none = |assets: &[PathBuf], tag: &Option<String>| {
        if assets.is_empty() && tag.is_none() {
            Ok(())
        } else {
            Err(format!("{command} takes no tag or assets"))
        }
    };
    match command.as_str() {
        "keygen" => {
            none(&assets, &tag)?;
            Ok(Command::Keygen {
                private_key: need(private_key, "--private-key")?,
                public_key,
            })
        }
        "sign" if public_key.is_none() => Ok(Command::Sign {
            private_key: need(private_key, "--private-key")?,
            tag: need_tag(tag)?,
            assets: need_assets(assets)?,
        }),
        "verify" if private_key.is_none() => Ok(Command::Verify {
            public_key: need(public_key, "--public-key")?,
            tag: need_tag(tag)?,
            assets: need_assets(assets)?,
        }),
        "check-key" if private_key.is_none() => {
            none(&assets, &tag)?;
            Ok(Command::CheckKey {
                public_key: need(public_key, "--public-key")?,
            })
        }
        "sign" | "verify" | "check-key" => Err(format!("{command} was given the other key")),
        other => Err(format!("unknown command {other}")),
    }
}

/// The name an asset is published and signed under.
pub fn asset_name(path: &Path) -> Result<String, String> {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(str::to_string)
        .ok_or_else(|| format!("{} has no UTF-8 file name", path.display()))
}

/// Where `asset`'s signature is written and read.
pub fn signature_path(asset: &Path) -> PathBuf {
    let mut name = asset.as_os_str().to_owned();
    name.push(SIGNATURE_SUFFIX);
    PathBuf::from(name)
}

/// The `.mldsa.sig` file's contents for `bytes`, published as `name` in release `tag`.
pub fn sign(
    key: &ReleaseSigningKey,
    tag: &str,
    name: &str,
    bytes: &[u8],
) -> Result<String, Refusal> {
    let digest = citadel_release_signature::sha256(bytes);
    Ok(format!("{}\n", key.sign(tag, name, &digest)?))
}

/// What the updater decides for these bytes and this signature file.
pub fn verify(
    public_key: &str,
    tag: &str,
    name: &str,
    bytes: &[u8],
    signature: &str,
) -> Result<(), Refusal> {
    let digest = citadel_release_signature::sha256(bytes);
    citadel_release_signature::verify(public_key, tag, name, &digest, signature)
}

#[cfg(test)]
mod tests;
