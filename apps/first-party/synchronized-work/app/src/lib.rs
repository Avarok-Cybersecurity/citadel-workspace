//! synchronized.work (`work.synchronized.app`): the module. The app is `sw_app::SwApp`, whose
//! every decision is `sw-app-core`'s; this crate only exports it through the ABI.

#[cfg(target_arch = "wasm32")]
citadel_app_sdk::export_app!(sw_app::SwApp);

#[cfg(test)]
mod manifest_tests;
