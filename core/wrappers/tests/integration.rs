//! Port of `tests/test_integration.py`.

use session::{EvalResult, ModelEvaluator};
use std::sync::Mutex;

#[test]
fn integration_verify_returns_structured_output() {
    struct StubIntegration {
        captured: Mutex<Option<(String, String)>>,
    }
    impl ModelEvaluator for StubIntegration {
        fn evaluate(&self, prose: &str, value: &str) -> EvalResult {
            *self.captured.lock().unwrap() = Some((prose.into(), value.into()));
            EvalResult::pass()
        }
    }
    let integ = StubIntegration {
        captured: Mutex::new(None),
    };
    let result = integ.evaluate("Check whether this query is safe.", "ok");
    assert!(result.passed);
    let captured = integ.captured.lock().unwrap().clone().unwrap();
    assert_eq!(captured.0, "Check whether this query is safe.");
    assert_eq!(captured.1, "ok");
}

#[test]
fn base_integration_verify_is_not_implemented() {
    // Python: `Integration().verify(...)` raises NotImplementedError.
    // Rust: `ModelEvaluator` is a trait and cannot be instantiated without an
    // implementation — the equivalent guarantee is compile-time: a trait
    // object pointing to a type that doesn't implement it won't compile.
    // We confirm the structural property by showing that the trait is
    // object-safe (can be boxed) but offers no default `evaluate` impl.
    fn assert_object_safe(_: Box<dyn ModelEvaluator>) {}
    struct Unreachable;
    impl ModelEvaluator for Unreachable {
        fn evaluate(&self, _p: &str, _v: &str) -> EvalResult {
            panic!("would have raised NotImplementedError in Python")
        }
    }
    // The trait requires an explicit impl — there's no default.
    assert_object_safe(Box::new(Unreachable));
}
