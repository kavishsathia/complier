//! Stub `ContractValidator` — mirrors Python's placeholder that only
//! checks the input is not None. Kept for API parity.

#[derive(Debug, Default, Clone)]
pub struct ContractValidator;

impl ContractValidator {
    pub fn new() -> Self {
        Self
    }

    /// Validate an opaque input. Mirrors the Python stub: rejects `None`,
    /// accepts anything else. In Rust, `None` is expressed as `Option::None`;
    /// the method takes `Option<&T>` so callers can pass `None` to trigger
    /// the error path.
    pub fn validate<T>(&self, input: Option<&T>) -> Result<(), String> {
        match input {
            None => Err("ContractValidator.validate requires a non-None input.".into()),
            Some(_) => Ok(()),
        }
    }
}
