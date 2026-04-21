//! Port of `tests/memory/test_store.py`.
//! Python has a thin `MemoryStore` wrapper around `Memory.from_file` / `save`.
//! The Rust crate has no separate store — `Memory` exposes `from_file`/`save`
//! directly. We port the behavioral intent.

use session::Memory;

#[test]
fn load_delegates_to_memory_from_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("memory.cplm");
    std::fs::write(&path, r#"{"checks": {}}"#).unwrap();
    let m = Memory::from_file(&path).unwrap();
    assert!(m.checks.is_empty());
}

#[test]
fn save_delegates_to_memory_save() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("memory.cplm");
    let mut m = Memory::empty();
    m.update_check("polite", "Use a polite tone.");
    m.save(&path).unwrap();
    let loaded = Memory::from_file(&path).unwrap();
    assert_eq!(loaded.get_check("polite"), "Use a polite tone.");
}
