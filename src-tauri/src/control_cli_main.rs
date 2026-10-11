// PowerShell must wait for the console client; the desktop remains a GUI binary.
fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        args.push("--help".into());
    }
    let code = monocode_lib::control_cli::maybe_run(args)
        .unwrap_or_else(|| monocode_lib::control_cli::run_app(vec!["unknown".into()]));
    std::process::exit(code);
}
