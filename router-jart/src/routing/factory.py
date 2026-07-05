"""Composition root for the routing subsystem."""
from __future__ import annotations

import httpx

from .adapters.forwarder.http_stream import HttpStreamForwarder
from .adapters.registry.control_plane_http import ControlPlaneRegistry
from .core.models import RoutingConfig
from .core.ports import IChatForwarder
from .core.service import RoutingService


def build_routing_components(
    config: RoutingConfig, client: httpx.AsyncClient
) -> tuple[RoutingService, IChatForwarder]:
    """Wire the registry, selection service and forwarder over a shared client."""
    registry = ControlPlaneRegistry(client, config.control_plane_url)
    service = RoutingService(registry)
    forwarder = HttpStreamForwarder(client)
    return service, forwarder
