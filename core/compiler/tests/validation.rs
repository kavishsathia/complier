//! Port of `tests/contract/test_validation.py`.

use compiler::ContractValidator;

#[test]
fn validate_rejects_none() {
    let v = ContractValidator::new();
    let none: Option<&()> = None;
    assert!(v.validate(none).is_err());
}

#[test]
fn validate_accepts_non_none_objects() {
    let v = ContractValidator::new();
    let some = ();
    assert!(v.validate(Some(&some)).is_ok());
}
