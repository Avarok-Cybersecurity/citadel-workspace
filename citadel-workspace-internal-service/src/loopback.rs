//! The agent's loopback TLS identity: what was configured, and where the certificate comes from.
//!
//! A hosted UI reaches the agent on the user's own machine as `wss://<name>:<port>`, where the
//! operator points `<name>` at 127.0.0.1 and holds a real certificate for it (see the connector's
//! io_interface/tls.rs for why a certificate at all). The certificate is ninety-day and is never
//! embedded in the binary: it is either handed in as files or fetched from the hosting site at
//! start and cached beside the agent's data, so an installed copy keeps working across renewals
//! and works offline once it has fetched once.
//!
//! Resolution is pure and tested; only `obtain` touches the network and the filesystem.
use std::path::{Path, PathBuf};

/// What the operator asked for. No `Default`: plain WebSocket is the absence of all of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TlsChoice {
    /// Plain `ws://` on loopback, behind the UI's own proxy. The existing behaviour.
    Plain,
    /// TLS from PEM files on disk.
    Files {
        cert: PathBuf,
        key: PathBuf,
        name: Option<String>,
    },
    /// TLS from `<url>/loopback.pem` and `<url>/loopback.key`, cached under `cache_dir`.
    Fetch {
        url: String,
        cache_dir: PathBuf,
        name: Option<String>,
    },
}

/// Inputs, env first then CLI, matching `select_backend_type` and `resolve_origin_policy`:
/// a docker operator changes behaviour without rebuilding. Empty strings are unset.
#[derive(Debug, Clone)]
pub struct TlsInputs<'a> {
    pub env_host: Option<&'a str>,
    pub env_cert_url: Option<&'a str>,
    pub env_cert: Option<&'a str>,
    pub env_key: Option<&'a str>,
    pub cli_host: Option<&'a str>,
    pub cli_cert_url: Option<&'a str>,
    pub cli_cert: Option<&'a str>,
    pub cli_key: Option<&'a str>,
    /// Where a fetched certificate is cached: the data dir when there is one.
    pub cache_root: &'a Path,
}

impl<'a> TlsInputs<'a> {
    /// Nothing configured; fill in what the caller has.
    pub fn none(cache_root: &'a Path) -> Self {
        Self {
            env_host: None,
            env_cert_url: None,
            env_cert: None,
            env_key: None,
            cli_host: None,
            cli_cert_url: None,
            cli_cert: None,
            cli_key: None,
            cache_root,
        }
    }
}

fn pick<'a>(env: Option<&'a str>, cli: Option<&'a str>) -> Option<&'a str> {
    env.filter(|s| !s.trim().is_empty())
        .or(cli.filter(|s| !s.trim().is_empty()))
        .map(str::trim)
}

/// Decide, or say what is inconsistent. A published name without a certificate source is
/// refused: the name only means something as a TLS name, and "you set --loopback-host and it
/// silently ran plain" is the failure this exists to prevent. Files and a URL together are
/// refused too -- two sources is one too many to be sure which one is serving.
pub fn choose_tls(inputs: &TlsInputs<'_>) -> Result<TlsChoice, String> {
    let name = pick(inputs.env_host, inputs.cli_host).map(|n| n.to_ascii_lowercase());
    if let Some(n) = &name {
        if !n
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
            || n.starts_with('.')
            || n.ends_with('.')
        {
            return Err(format!(
                "loopback host {n:?} must be a bare DNS name (letters, digits, dots, hyphens); no scheme, port or path"
            ));
        }
    }
    let url = pick(inputs.env_cert_url, inputs.cli_cert_url);
    let cert = pick(inputs.env_cert, inputs.cli_cert);
    let key = pick(inputs.env_key, inputs.cli_key);
    match (url, cert, key) {
        (None, None, None) => match name {
            None => Ok(TlsChoice::Plain),
            Some(n) => Err(format!(
                "loopback host {n:?} was given but no certificate source: pass --loopback-cert-url \
                 (INTERNAL_SERVICE_LOOPBACK_CERT_URL) or --tls-cert/--tls-key"
            )),
        },
        (Some(_), Some(_), _) | (Some(_), _, Some(_)) => Err(
            "both a certificate URL and certificate files were given; use one source".to_string(),
        ),
        (Some(url), None, None) => {
            if !url.starts_with("https://") {
                return Err(format!(
                    "loopback certificate URL {url:?} must be https:// -- the private key travels over it"
                ));
            }
            Ok(TlsChoice::Fetch {
                url: url.trim_end_matches('/').to_string(),
                cache_dir: inputs.cache_root.join("loopback"),
                name,
            })
        }
        (None, Some(cert), Some(key)) => Ok(TlsChoice::Files {
            cert: PathBuf::from(cert),
            key: PathBuf::from(key),
            name,
        }),
        (None, Some(_), None) | (None, None, Some(_)) => {
            Err("--tls-cert and --tls-key go together; one was given without the other".to_string())
        }
    }
}

/// A certificate and its key, PEM.
pub struct Pem {
    pub certificate: Vec<u8>,
    pub key: Vec<u8>,
}

/// Lengths only. The key is public by construction, but a panic message or a log line is
/// still not where it belongs.
impl std::fmt::Debug for Pem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Pem")
            .field("certificate_bytes", &self.certificate.len())
            .field("key_bytes", &self.key.len())
            .finish()
    }
}

/// Obtain the PEM pair the choice names. Files are read; a URL is fetched (the network first,
/// then whatever was cached) and the fresh copy written back so the next start works offline
/// and a replaced certificate does not outlive its usefulness.
pub fn obtain(choice: &TlsChoice) -> Result<Option<Pem>, String> {
    match choice {
        TlsChoice::Plain => Ok(None),
        TlsChoice::Files { cert, key, .. } => Ok(Some(Pem {
            certificate: std::fs::read(cert)
                .map_err(|e| format!("reading {}: {e}", cert.display()))?,
            key: std::fs::read(key).map_err(|e| format!("reading {}: {e}", key.display()))?,
        })),
        TlsChoice::Fetch { url, cache_dir, .. } => match fetch_pair(url) {
            Ok(fresh) => {
                if let Err(e) = store(cache_dir, &fresh) {
                    citadel_logging::warn!(target: "citadel", "could not cache the loopback certificate under {}: {e}", cache_dir.display());
                }
                Ok(Some(fresh))
            }
            Err(fetch_err) => match load(cache_dir) {
                Some(cached) => {
                    citadel_logging::warn!(target: "citadel", "could not fetch the loopback certificate ({fetch_err}); using the cached copy");
                    Ok(Some(cached))
                }
                None => Err(format!(
                    "{fetch_err}, and nothing is cached under {}",
                    cache_dir.display()
                )),
            },
        },
    }
}

/// One GET, via the system `curl`: the agent has no HTTP client of its own, and one call at
/// start does not justify a client crate in a binary people download. HTTPS only, TLS 1.2+,
/// a short timeout so an offline start is delayed by seconds, not minutes.
fn fetch_one(url: &str) -> Result<Vec<u8>, String> {
    let out = std::process::Command::new("curl")
        .args([
            "-fsSL",
            "--proto",
            "=https",
            "--tlsv1.2",
            "--max-time",
            "4",
            url,
        ])
        .output()
        .map_err(|e| format!("running curl for {url}: {e}"))?;
    if !out.status.success() {
        return Err(format!("fetching {url}: curl exited {}", out.status));
    }
    // A site that answers a missing file with a page of HTML would otherwise be handed to the
    // TLS stack as a certificate and fail later and less clearly.
    if !out.stdout.starts_with(b"-----BEGIN") {
        return Err(format!("{url} did not return PEM"));
    }
    Ok(out.stdout)
}

fn fetch_pair(base: &str) -> Result<Pem, String> {
    Ok(Pem {
        certificate: fetch_one(&format!("{base}/loopback.pem"))?,
        key: fetch_one(&format!("{base}/loopback.key"))?,
    })
}

fn load(dir: &Path) -> Option<Pem> {
    let pem = Pem {
        certificate: std::fs::read(dir.join("loopback.pem")).ok()?,
        key: std::fs::read(dir.join("loopback.key")).ok()?,
    };
    (!pem.certificate.is_empty() && !pem.key.is_empty()).then_some(pem)
}

fn store(dir: &Path, pem: &Pem) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::write(dir.join("loopback.pem"), &pem.certificate)?;
    let key = dir.join("loopback.key");
    std::fs::write(&key, &pem.key)?;
    // 0600. The key is published on a website, so this protects nothing from a determined
    // reader -- but a world-readable private key on a shared machine is what scanners report.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&key, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "loopback_tests.rs"]
mod tests;
