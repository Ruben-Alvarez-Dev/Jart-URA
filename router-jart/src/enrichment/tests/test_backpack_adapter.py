"""Tests for BackpackMemoryAdapter."""
import json
import pytest
from http.server import HTTPServer, BaseHTTPRequestHandler

from ..adapters.memory.backpack import BackpackMemoryAdapter
from ..core.models import EnrichmentConfig


class MockBackpackHandler(BaseHTTPRequestHandler):
    """Mock Backpack API for testing."""

    response_data = None

    def do_POST(self):
        if self.path == "/api/request-context":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(self.response_data or {
                "context_pack": {
                    "summary": "[JART-MEMORY: test fact\n[/JART-MEMORY]",
                    "sources": [
                        {"content_preview": "test fact", "score": 0.85, "layer": 3, "scope": "test"}
                    ],
                },
                "injection_text": "[JART-MEMORY: test fact\n[/JART-MEMORY]",
            }).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path == "/api/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # suppress logs


@pytest.fixture
def mock_backpack():
    server = HTTPServer(("localhost", 19990), MockBackpackHandler)
    import threading
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server
    server.shutdown()


@pytest.mark.asyncio
async def test_query_returns_facts(mock_backpack):
    adapter = BackpackMemoryAdapter(backpack_url="http://localhost:19990", config=EnrichmentConfig(min_score=0.0))
    result = await adapter.query("what is the router config?")
    assert result.has_context
    assert len(result.facts) == 1
    assert result.facts[0].content == "test fact"


@pytest.mark.asyncio
async def test_query_timeout_returns_empty():
    adapter = BackpackMemoryAdapter(backpack_url="http://localhost:19991", config=EnrichmentConfig(timeout_ms=100))
    result = await adapter.query("test", timeout_ms=100)
    assert not result.has_context


@pytest.mark.asyncio
async def test_health_when_up(mock_backpack):
    adapter = BackpackMemoryAdapter(backpack_url="http://localhost:19990")
    assert await adapter.health() is True


@pytest.mark.asyncio
async def test_health_when_down():
    adapter = BackpackMemoryAdapter(backpack_url="http://localhost:19991")
    assert await adapter.health() is False
