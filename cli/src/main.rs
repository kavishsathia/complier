mod csp;
mod daemon;
mod hook;
mod init;
mod launchd;
mod paths;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "complier", version, about = "Enforce CSP contracts on Claude Code")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Set up this repo: hooks, a demo contract and the background daemon
    Init,
    /// Handle one Claude Code hook event from stdin (called by Claude Code)
    Hook,
    /// Run the daemon in the foreground (launchd runs this for you)
    Daemon,
    /// Show each session's contract state
    Status,
    /// Forget session state for this repo's contract
    Reset,
    /// Check a contract file and print its alphabet and first events
    Check { path: std::path::PathBuf },
    /// Remove the hooks from this repo and stop the daemon
    Uninstall,
}

fn main() {
    let code = match Cli::parse().command {
        Command::Init => init::run(),
        Command::Hook => hook::run(),
        Command::Daemon => daemon::serve(),
        Command::Status => daemon::status(),
        Command::Reset => daemon::reset(),
        Command::Check { path } => check(&path),
        Command::Uninstall => init::uninstall(),
    };
    std::process::exit(code);
}

fn check(path: &std::path::Path) -> i32 {
    let src = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("complier: {}: {e}", path.display());
            return 1;
        }
    };
    match csp::parse(&src) {
        Ok(c) => {
            let alphabet: Vec<_> = c.alphabet.iter().cloned().collect();
            let first: Vec<_> = c.initials(&c.initial()).into_iter().collect();
            println!("ok: {} starts at {}", path.display(), c.main);
            println!("constrained tools: {}", alphabet.join(", "));
            println!("allowed first: {}", first.join(", "));
            0
        }
        Err(e) => {
            eprintln!("complier: {}: {e}", path.display());
            1
        }
    }
}
