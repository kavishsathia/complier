"""Parser entry points for authored contract specs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from lark import Lark, Tree


_GRAMMAR = r"""
start: source_blob
source_blob: SOURCE_TEXT

SOURCE_TEXT: /[\s\S]+/
"""


@dataclass(slots=True)
class ParsedContract:
    """Intermediate parsed contract representation."""

    source: str
    tree: Tree[Any]


@dataclass(slots=True)
class ContractParser:
    """Parses source text into an intermediate contract representation."""

    parser: Lark = Lark(_GRAMMAR, start="start", parser="lalr")

    def parse(self, source: str) -> ParsedContract:
        """Return a parsed representation of the source contract."""
        if not isinstance(source, str):
            raise TypeError("Contract source must be a string.")
        if not source.strip():
            raise ValueError("Contract source cannot be empty.")

        tree = self.parser.parse(source)
        return ParsedContract(source=source, tree=tree)
