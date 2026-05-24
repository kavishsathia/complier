use clap::{Parser, Subcommand};

mod commands;
mod daemon;
mod extensions;

#[derive(Parser)]
#[command(
    name = "complier",
    version,
    about = "complier CLI — runtime contract enforcement for tool-using agents."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Handle a hook event for the given extension. Reads the event JSON from stdin
    /// and writes the harness-shaped response to stdout.
    Hook {
        /// Extension name (e.g. "cc" for Claude Code).
        extension: String,
    },
    /// Stage a branch / unordered choice for the next tool call.
    Choose {
        /// Arm label, matching one of the workflow's branch / unordered arms.
        arm: String,
    },
    /// Install hook entries for the given extension into its harness's settings.
    Install {
        /// Extension name (e.g. "cc" for Claude Code).
        extension: String,
    },
}

fn main() {
    let cli = Cli::parse();
    let exit = match cli.command {
        Command::Hook { extension } => commands::hook::run(&extension),
        Command::Choose { arm } => commands::choose::run(&arm),
        Command::Install { extension } => commands::install::run(&extension),
    };
    std::process::exit(exit);
}
