use crate::extensions;

pub fn run(extension: &str) -> i32 {
    match extension {
        "cc" => extensions::cc::setup(),
        other => {
            eprintln!("complier install: unknown extension {other:?}");
            1
        }
    }
}
