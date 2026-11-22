// A release build on Windows is a GUI-subsystem program: no console window opens when it is
// started from the Start menu, the login entry or the installer. Output then goes where
// `windows_shell::init` routes it. Debug builds keep the console a developer reads.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use std::error::Error;
use std::net::SocketAddr;
use std::path::PathBuf;
use structopt::StructOpt;

mod app_net;
mod apps_authority;
mod fresh_start;
mod identity_setup;
mod log_setup;
mod notice_token;
mod p2p_kex_setup;
mod run;
mod server_certificate;
mod server_identity_codec;
mod shell_menu;
mod startup_config;
mod telemetry;
#[cfg(feature = "self-update")]
mod update_setup;
#[cfg(windows)]
mod windows_shell;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    #[cfg(windows)]
    windows_shell::init();
    let result = run::run().await;
    // With no console, a failure printed by returning it from main is seen by nobody.
    #[cfg(windows)]
    if let Err(error) = &result {
        windows_shell::report_fatal(error.as_ref());
    }
    // An earlier agent's data, not started fresh: the status a launcher acts on (fresh_start).
    if let Err(refused) = &result {
        if refused.downcast_ref::<fresh_start::Refused>().is_some() {
            #[cfg(not(windows))]
            eprintln!("Error: {refused}");
            std::process::exit(fresh_start::START_FRESH_EXIT_CODE);
        }
    }
    result
}

/// What clap does for `Options::from_args`, except that on Windows a usage error is also shown in
/// a dialog when there is no terminal to print it on.
fn parse_options() -> Options {
    match Options::from_args_safe() {
        Ok(options) => options,
        Err(error) => {
            #[cfg(windows)]
            if error.use_stderr() {
                windows_shell::report_fatal(&error);
            }
            error.exit()
        }
    }
}

#[derive(Debug, StructOpt)]
// `--version` prints "citadel-agent <Cargo.toml version>", which the release gates compare
// with the tag (scripts/release-version.sh, scripts/lib/assert-agent-version.sh).
#[structopt(
    name = "citadel-agent",
    version = env!("CARGO_PKG_VERSION"),
    about = "Used for running a local service for citadel applications"
)]
struct Options {
    #[structopt(short, long)]
    bind: SocketAddr,
    #[structopt(short, long)]
    dangerous: Option<bool>,
    /// Backend type: "filesystem" for persistent storage, omit for in-memory
    #[structopt(long)]
    backend: Option<String>,
    /// Data directory for the filesystem backend. Defaults to `.citadel-agent` in
    /// the user's home directory (or `./data` where an existing one is found).
    #[structopt(long)]
    data_dir: Option<String>,
    /// Comma-separated list of browser origins allowed to open a control
    /// connection, e.g. "http://localhost:5291". Pass "*" to accept any origin
    /// (development only). Required; may also be given as
    /// INTERNAL_SERVICE_ALLOWED_ORIGINS, which takes precedence.
    #[structopt(long)]
    allowed_origins: Option<String>,
    /// Exactly three STUN servers, `host:port,host:port,host:port`, that this agent learns
    /// its public address from. Required; INTERNAL_SERVICE_STUN_SERVERS overrides it.
    #[structopt(long)]
    stun_servers: Option<String>,
    /// Serve plain `ws://` instead of `wss://`.
    ///
    /// Only correct when the page is itself on loopback and reaches the agent
    /// through a same-origin proxy. A page served over HTTPS cannot open a
    /// `ws://` socket at all, so this makes the agent unreachable from a hosted
    /// UI.
    #[structopt(long)]
    no_tls: bool,
    /// Resolve every required setting and exit 0, before binding anything; exit non-zero
    /// with the reason when one does not resolve. What an updating agent asks of a staged
    /// version with its own command.
    #[structopt(long)]
    check_launch: bool,
    /// The data directory the person agreed to start fresh from, in a launcher's dialog: when
    /// this agent refuses it as an earlier agent's, it is moved to the Trash and a new one begun.
    /// Any other directory, or a readable one, is left alone (fresh_start).
    #[structopt(long, parse(from_os_str))]
    start_fresh_from: Option<PathBuf>,
    /// Whole seconds the unsealed portable identity is kept after its last use. Required;
    /// INTERNAL_SERVICE_IDENTITY_UNLOCK_IDLE_SECS overrides it.
    #[structopt(long)]
    identity_unlock_idle_secs: Option<String>,
}

/// The certificate the agent serves, and the only one.
///
/// There is no override. Every hosted page dials `wss://local.avarok.net:12345`, so
/// a different certificate could only ever break that handshake. Release builds
/// compile in a certificate issued at build time (release-agent.yml), so no
/// published agent carries one older than its release.
///
///
/// `local.avarok.net` is a public name whose A record is 127.0.0.1, so a
/// publicly-trusted certificate can be issued for it and every visitor's own
/// agent can present it. That is what makes a HOSTED page able to reach an
/// agent on the visitor's machine: the browser refuses `ws://` from an HTTPS
/// page, and refuses `wss://` without a certificate it trusts.
///
/// The private key is therefore inside a binary anyone can download, and that
/// is deliberate. What it authorises is a TLS handshake for a name that only
/// ever resolves to the loopback interface of the machine doing the
/// handshaking, so possession grants no access to anything of anyone else's.
/// The agent's own authorisation is the Origin allowlist, which is unchanged
/// and required.
const BUILTIN_TLS_CERT: &[u8] = include_bytes!("../tls/local.avarok.net.crt.pem");
const BUILTIN_TLS_KEY: &[u8] = include_bytes!("../tls/local.avarok.net.key.pem");

#[cfg(feature = "deadlock-detection")]
lazy_static::lazy_static! {
    static ref DEADLOCK_INIT: () = {
        let _ = std::thread::spawn(move || {
            info!(target: "gadget", "Executing deadlock detector ...");
            use std::thread;
            use std::time::Duration;
            use parking_lot::deadlock;
            use citadel_logging::*;
            loop {
                std::thread::sleep(Duration::from_secs(5));
                let deadlocks = deadlock::check_deadlock();
                if deadlocks.is_empty() {
                    continue;
                }

                error!(target: "citadel", "{} deadlocks detected", deadlocks.len());
                for (i, threads) in deadlocks.iter().enumerate() {
                    error!(target: "citadel", "Deadlock #{}", i);
                    for t in threads {
                        error!(target: "citadel", "Thread Id {:#?}", t.thread_id());
                        error!(target: "citadel", "{:#?}", t.backtrace());
                    }
                }
            }
        });
    };
}
