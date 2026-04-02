"""Tests for MCP wrapper stubs."""

import unittest

from complier.contract.model import Contract
from complier.wrappers.mcp import MCPWrapper


class MCPWrapperTests(unittest.TestCase):
    def test_wrap_client_is_not_implemented(self) -> None:
        wrapper = MCPWrapper(session=Contract(name="demo").create_session())

        with self.assertRaises(NotImplementedError):
            wrapper.wrap_client(object())

    def test_wrap_server_is_not_implemented(self) -> None:
        wrapper = MCPWrapper(session=Contract(name="demo").create_session())

        with self.assertRaises(NotImplementedError):
            wrapper.wrap_server(object())
