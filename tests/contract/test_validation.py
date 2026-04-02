"""Tests for contract validation."""

import unittest

from complier.contract.validation import ContractValidator


class ContractValidationTests(unittest.TestCase):
    def test_validate_rejects_none(self) -> None:
        with self.assertRaises(ValueError):
            ContractValidator().validate(None)

    def test_validate_accepts_non_none_objects(self) -> None:
        ContractValidator().validate(object())
