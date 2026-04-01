"""Tests for visualizer graph export and local serving."""

import json
import io
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from complier.contract.model import Contract
from complier.visualizer import contract_to_graph
from complier.visualizer.server import VisualizerServer, serve_contract


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

    def test_visualizer_server_close_stops_http_server_and_thread(self) -> None:
        httpd = unittest.mock.Mock()
        thread = unittest.mock.Mock()
        server = VisualizerServer(httpd=httpd, thread=thread, url="http://127.0.0.1:8766")

        server.close()

        httpd.shutdown.assert_called_once_with()
        thread.join.assert_called_once_with(timeout=1.0)


class VisualizerServerIntegrationTests(unittest.TestCase):
    def test_serves_contract_json_from_api_endpoint(self) -> None:
        contract = Contract.from_source(
            """
workflow "research"
    | search_web
"""
        )

        with TemporaryDirectory() as tmp:
            visualizer_dir = Path(tmp) / "visualizer"
            visualizer_dir.mkdir()
            (visualizer_dir / "index.html").write_text("<html>ok</html>", encoding="utf-8")

            with _working_directory(Path(tmp)):
                handler = _build_handler(contract, "/api/contract")
                handler.do_GET()
                payload = json.loads(handler.wfile.getvalue().decode("utf-8"))

        self.assertEqual(payload["name"], "anonymous")
        self.assertIn("research", payload["workflows"])
        handler.send_response.assert_called_once_with(200)
        self.assertIn(
            ("Content-Type", "application/json; charset=utf-8"),
            _header_calls(handler),
        )

    def test_serves_index_and_static_assets_from_visualizer_directory(self) -> None:
        contract = Contract.from_source(
            """
workflow "research"
    | search_web
"""
        )

        with TemporaryDirectory() as tmp:
            visualizer_dir = Path(tmp) / "visualizer"
            visualizer_dir.mkdir()
            (visualizer_dir / "index.html").write_text("<html>index</html>", encoding="utf-8")
            (visualizer_dir / "app.js").write_text('console.log("ok");', encoding="utf-8")

            with _working_directory(Path(tmp)):
                index_handler = _build_handler(contract, "/")
                index_handler.do_GET()
                index_body = index_handler.wfile.getvalue().decode("utf-8")

                asset_handler = _build_handler(contract, "/app.js")
                asset_handler.do_GET()
                asset_body = asset_handler.wfile.getvalue().decode("utf-8")

        self.assertEqual(index_body, "<html>index</html>")
        self.assertIn(
            ("Content-Type", "text/html; charset=utf-8"),
            _header_calls(index_handler),
        )
        self.assertEqual(asset_body, 'console.log("ok");')
        self.assertIn(("Content-Type", "text/javascript"), _header_calls(asset_handler))

    def test_returns_not_found_payload_when_visualizer_app_is_missing(self) -> None:
        contract = Contract.from_source(
            """
workflow "research"
    | search_web
"""
        )

        with TemporaryDirectory() as tmp:
            with _working_directory(Path(tmp)):
                handler = _build_handler(contract, "/")
                handler.do_GET()
                payload = json.loads(handler.wfile.getvalue().decode("utf-8"))

        handler.send_response.assert_called_once_with(404)
        self.assertEqual(payload["error"], "Visualizer app not found.")
        self.assertTrue(payload["expected"].endswith("visualizer/index.html"))

    def test_rejects_static_path_traversal_requests(self) -> None:
        contract = Contract.from_source(
            """
workflow "research"
    | search_web
"""
        )

        with TemporaryDirectory() as tmp:
            visualizer_dir = Path(tmp) / "visualizer"
            visualizer_dir.mkdir()
            (visualizer_dir / "index.html").write_text("<html>index</html>", encoding="utf-8")
            (Path(tmp) / "secret.txt").write_text("do not serve", encoding="utf-8")

            with _working_directory(Path(tmp)):
                handler = _build_handler(contract, "/../secret.txt")
                handler.do_GET()
                payload = json.loads(handler.wfile.getvalue().decode("utf-8"))

        handler.send_response.assert_called_once_with(404)
        self.assertEqual(payload, {"error": "Not found."})


class _working_directory:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._original: str | None = None

    def __enter__(self) -> None:
        self._original = os.getcwd()
        os.chdir(self._path)

    def __exit__(self, exc_type, exc, tb) -> None:
        assert self._original is not None
        os.chdir(self._original)


def _build_handler(contract: Contract, path: str):
    handler_class = None

    with patch("complier.visualizer.server.ThreadingHTTPServer") as httpd_cls:
        with patch("complier.visualizer.server.Thread"):
            serve_contract(contract, port=8767)

    handler_class = httpd_cls.call_args.args[1]
    handler = object.__new__(handler_class)
    handler.path = path
    handler.wfile = io.BytesIO()
    handler.send_response = unittest.mock.Mock()
    handler.send_header = unittest.mock.Mock()
    handler.end_headers = unittest.mock.Mock()
    return handler


def _header_calls(handler) -> list[tuple[str, str]]:
    return [call.args for call in handler.send_header.call_args_list]
