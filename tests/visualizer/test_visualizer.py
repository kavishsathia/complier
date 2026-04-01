"""Tests for visualizer graph export and local serving."""

import unittest
from unittest.mock import patch

from complier.contract.model import Contract
from complier.visualizer import contract_to_graph
from complier.visualizer.server import VisualizerServer


class VisualizerTests(unittest.TestCase):
    def test_contract_to_graph_serializes_workflows_nodes_and_edges(self) -> None:
        contract = Contract.from_source(
            """
workflow "research"
    | search_web
"""
        )

        payload = contract_to_graph(contract)

        self.assertEqual(payload["name"], "anonymous")
        self.assertIn("research", payload["workflows"])
        workflow = payload["workflows"]["research"]
        self.assertEqual(workflow["name"], "research")
        self.assertTrue(workflow["nodes"])
        self.assertTrue(workflow["edges"])

    def test_session_visualize_returns_server_handle(self) -> None:
        contract = Contract.from_source(
            """
workflow "research"
    | search_web
"""
        )
        session = contract.create_session()

        with patch("complier.visualizer.server.ThreadingHTTPServer") as httpd_cls:
            with patch("complier.visualizer.server.Thread") as thread_cls:
                server = session.visualize(port=8766)

        self.assertIsInstance(server, VisualizerServer)
        self.assertEqual(server.url, "http://127.0.0.1:8766")
        httpd_cls.assert_called_once()
        thread_cls.assert_called_once()
        thread_cls.return_value.start.assert_called_once()
