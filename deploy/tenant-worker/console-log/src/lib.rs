//! Logging for a wasm module hosted by a JS runtime.
//!
//! The SDK and the kernel log through `tracing` and `log`; on wasm32 the default `fmt` subscriber
//! writes to a stdout that does not exist, so every line would vanish. This routes both to
//! `console.log`, which Workers (`wrangler dev` prints it) and Node both surface.

use std::io::Write;

struct ConsoleWriter(Vec<u8>);

impl Write for ConsoleWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Drop for ConsoleWriter {
    fn drop(&mut self) {
        let line = String::from_utf8_lossy(&self.0);
        let line = line.trim_end();
        if !line.is_empty() {
            web_sys::console::log_1(&line.into());
        }
    }
}

/// Install the console subscriber and panic hook once. `filter` is an `EnvFilter` directive
/// string (`"citadel=info"`); the host names it, since there is no environment to read one from.
pub fn init(filter: &str) {
    console_error_panic_hook::set_once();
    let _ = tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::new(filter))
        .with_writer(|| ConsoleWriter(Vec::new()))
        .with_ansi(false)
        .without_time()
        .try_init();
}
