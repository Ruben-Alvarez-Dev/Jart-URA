"""Real integration test against a live Control Plane.

No mocks: it talks to a real Control Plane at ``CONTROL_PLANE_URL``. When no
Control Plane is reachable (e.g. CI without the fleet) the whole module is
skipped — skipping is honest, fabricating a fake backend would not be.

Run it on a node where Jart-URA is up:
    CONTROL_PLANE_URL=http://localhost:9100 pytest src/routing/tests/test_passthrough_integration.py
"""
from __future__ import annotations

import os

import httpx
import pytest

from src.routing.adapters.registry.control_plane_http import ControlPlaneRegistry
from src.routing.core.service import RoutingService

CONTROL_PLANE_URL = os.getenv("CONTROL_PLANE_URL", "http://localhost:9100").rstrip("/")


def _control_plane_reachable() -> bool:
    try:
        httpx.get(f"{CONTROL_PLANE_URL}/health", timeout=1.0).raise_for_status()
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _control_plane_reachable(),
    reason=f"no live Control Plane at {CONTROL_PLANE_URL}",
)


async def test_registry_lists_real_models():
    async with httpx.AsyncClient(timeout=5.0) as client:
        registry = ControlPlaneRegistry(client, CONTROL_PLANE_URL)
        models = await registry.list_models()
    assert isinstance(models, list)
    for model in models:
        assert model.name
        assert model.port


async def test_service_resolves_against_real_registry():
    async with httpx.AsyncClient(timeout=5.0) as client:
        registry = ControlPlaneRegistry(client, CONTROL_PLANE_URL)
        service = RoutingService(registry)
        resolution = await service.resolve({})
    # Either a running chat model is selected, or a typed 503 (none running).
    assert resolution.ok or resolution.http_status == 503
