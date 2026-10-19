#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(code) = monocode_lib::ssh_askpass::maybe_run() {
        std::process::exit(code);
    }
    if let Some(code) = monocode_lib::control_cli::maybe_run(std::env::args().skip(1).collect()) {
        std::process::exit(code);
    }
    monocode_lib::run()
}
