"""Parser entry points for authored contract specs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from lark import Lark, Tree
from lark.indenter import Indenter

from .ast import Program
from .transformer import ContractTransformer


_GRAMMAR = r"""
start: _NL* item (_NL* item)* _NL*

item: guarantee | workflow

guarantee: "guarantee" IDENT contract_expr

workflow: "workflow" STRING always_clause* _NL _INDENT step+ _DEDENT
always_clause: "@always" IDENT

step: PIPE inline_step _NL
    | PIPE block_step

inline_step: llm_step
           | human_step
           | fork_step
           | join_step
           | subworkflow_step
           | tool_step

block_step: branch_block
          | loop_block
          | unordered_block

llm_step: "@llm" STRING
human_step: "@human" STRING
subworkflow_step: call_type IDENT
fork_step: "@fork" IDENT subworkflow_step
join_step: "@join" IDENT
tool_step: IDENT param*

branch_block: "@branch" _NL _INDENT when_arm+ else_arm? _DEDENT
when_arm: WHEN STRING _NL _INDENT step+ _DEDENT
else_arm: ELSE _NL _INDENT step+ _DEDENT

loop_block: "@loop" _NL _INDENT step+ until_clause _DEDENT
until_clause: UNTIL STRING _NL

unordered_block: "@unordered" _NL _INDENT unordered_step+ _DEDENT
unordered_step: STEP_KW STRING _NL _INDENT step+ _DEDENT

call_type: CALL | USE | INLINE
param: IDENT "=" param_value
?param_value: STRING
            | NUMBER          -> number_value
            | TRUE            -> true_value
            | FALSE           -> false_value
            | NULL            -> null_value
            | policy_expr      -> contract_expr

contract_expr: policy_expr
?policy_expr: or_expr
            | or_expr ":" check_policy -> policy_expr
?or_expr: and_expr
        | or_expr OR and_expr   -> or_expr
?and_expr: unary_expr
         | and_expr AND unary_expr -> and_expr
?unary_expr: NOT unary_expr     -> not_expr
           | contract_atom
?contract_atom: model_check
              | human_check
              | learned_check
              | IDENT           -> guarantee_ref
              | "(" policy_expr ")"

model_check: "[" check_name "]"
human_check: "{" check_name "}"
learned_check: "#{" check_name "}"
check_name: IDENT
check_policy: HALT -> halt_policy
            | SKIP -> skip_policy
            | NUMBER -> retry_policy

PIPE: "|"
WHEN: "-when"
ELSE: "-else"
UNTIL: "-until"
STEP_KW: "-step"
CALL: "@call"
USE: "@use"
INLINE: "@inline"
NOT: "!"
AND: "&&"
OR: "||"

IDENT: /[a-zA-Z_][a-zA-Z0-9_]*/
NUMBER: /[0-9]+/
HALT: "halt"
SKIP: "skip"
TRUE: "true"
FALSE: "false"
NULL: "null"

_NL: /(\r?\n[ \t]*)+/

%import common.ESCAPED_STRING -> STRING
%import common.WS_INLINE
%ignore WS_INLINE

%declare _INDENT _DEDENT
"""


@dataclass(slots=True)
class ParsedContract:
    """Intermediate parsed contract representation."""

    source: str
    tree: Tree[Any]
    program: Program


class ContractIndenter(Indenter):
    """Indentation handler for the contract DSL."""

    NL_type = "_NL"
    OPEN_PAREN_types: list[str] = []
    CLOSE_PAREN_types: list[str] = []
    INDENT_type = "_INDENT"
    DEDENT_type = "_DEDENT"
    tab_len = 8


@dataclass(slots=True)
class ContractParser:
    """Parses source text into an intermediate contract representation."""

    parser: Lark = Lark(_GRAMMAR, start="start", parser="lalr", postlex=ContractIndenter())

    def parse(self, source: str) -> ParsedContract:
        """Return a parsed representation of the source contract."""
        if not isinstance(source, str):
            raise TypeError("Contract source must be a string.")
        if not source.strip():
            raise ValueError("Contract source cannot be empty.")

        normalized_source = source if source.endswith("\n") else f"{source}\n"
        tree = self.parser.parse(normalized_source)
        program = ContractTransformer().transform(tree)
        return ParsedContract(source=source, tree=tree, program=program)
