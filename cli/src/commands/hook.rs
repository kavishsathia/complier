use crate::extensions;

pub fn run(extension: &str) -> i32 {
    match extension {
        "cc" => extensions::cc::run_hook(),
        other => {
            eprintln!("complier hook: unknown extension {other:?}");
            1
        }
    }
}
