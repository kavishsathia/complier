"""Shared helpers for contract parser tests."""

from complier.contract.parser import ContractParser


def parse_program(source: str):
    """Parse source text and return the typed AST program."""
    return ContractParser().parse(source).program
