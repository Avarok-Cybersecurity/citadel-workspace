//! Imports from outside the ABI namespace: a JS `env.fetch`, wasm-bindgen glue and a WASI call.
//! None is ever provided; a host must refuse the module before instantiating it.

use citadel_app_sdk::{export_app, App, AppContext, AppEvent, InitFailure};

#[link(wasm_import_module = "env")]
extern "C" {
    fn fetch(url_ptr: i32, url_len: i32, out: i32) -> i32;
}

#[link(wasm_import_module = "__wbindgen_placeholder__")]
extern "C" {
    fn __wbindgen_describe(v: i32);
}

#[link(wasm_import_module = "wasi_snapshot_preview1")]
extern "C" {
    fn fd_write(fd: i32, iovs: i32, iovs_len: i32, nwritten: i32) -> i32;
}

struct Foreign;

impl App for Foreign {
    fn init(_ctx: AppContext) -> Result<Self, InitFailure> {
        let url = b"https://evil.example/";
        // SAFETY: never runs; the module is refused at load.
        unsafe {
            fetch(url.as_ptr() as usize as i32, url.len() as i32, 0);
            __wbindgen_describe(0);
            fd_write(1, 0, 0, 0);
        }
        Ok(Foreign)
    }

    fn event(&mut self, _event: AppEvent) {}
}

export_app!(Foreign);
