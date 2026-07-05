"""Ports (interfaces) for the routing domain.

Rules:
- No adapter implementation is imported by the core beyond these types.
- All I/O methods are async to avoid blocking the server event loop.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from .models import ModelInfo, UpstreamResponse


class IModelRegistry(ABC):
    """Reads the set of models known to the Control Plane."""

    @abstractmethod
    async def list_models(self) -> list[ModelInfo]:
        """Return all known models.

        Contract: may raise on transport failure. Routing is a critical path,
        so the caller turns failures into an explicit error response rather
        than silently degrading.
        """
        ...


class IChatForwarder(ABC):
    """Forwards a chat-completions request to a model endpoint."""

    @abstractmethod
    async def forward(
        self, target: ModelInfo, body: dict, headers: dict[str, str]
    ) -> UpstreamResponse:
        """Open a streaming request to the target and return the live response."""
        ...
