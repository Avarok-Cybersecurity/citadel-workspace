// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[allow(warnings, unused)]
mod commands;
mod helpers;
mod structs;

fn main() {
    citadel_workspace_ui_lib::run()
}
