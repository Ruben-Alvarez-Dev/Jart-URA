"""Domain models for the routing subsystem."""
from __future__ import annotations

import os
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class ModelInfo:
    """A model as projected by the Control Plane registry (`GET /v1/registry`)."""

    name: str
    port: int
    type: str = "chat"
    status: str = "stopped"
    source: str = "local"

    @property
    def is_running(self) -> bool:
        return self.status == "running"

    @property
    def chat_completions_url(self) -> str:
        """OpenAI-compatible chat endpoint exposed on the model's own port."""
        return f"http://localhost:{self.port}/v1/chat/completions"


@dataclass(frozen=True)
class Resolution:
    """Outcome of resolving a request to a concrete model target."""

    target: ModelInfo | None
    error: str | None = None
    http_status: int = 200

    @property
    def ok(self) -> bool:
        return self.target is not None


@dataclass(frozen=True)
class UpstreamResponse:
    """A live, streamed response from an upstream model endpoint."""

    status_code: int
    media_type: str
    body: AsyncIterator[bytes]
    aclose: Callable[[], Awaitable[None]]


@dataclass
class RoutingConfig:
    """Configuration for the passthrough router."""

    control_plane_url: str = "http://localhost:9100"
    connect_timeout_s: float = 5.0
    read_timeout_s: float = 300.0

    @classmethod
    def from_env(cls) -> RoutingConfig:
        return cls(
            control_plane_url=os.getenv("CONTROL_PLANE_URL", "http://localhost:9100").rstrip("/"),
            connect_timeout_s=float(os.getenv("ROUTING_CONNECT_TIMEOUT_S", "5")),
            read_timeout_s=float(os.getenv("ROUTING_READ_TIMEOUT_S", "300")),
        )
