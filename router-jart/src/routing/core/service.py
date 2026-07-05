"""Routing service: selects the target model for a request."""
from __future__ import annotations

import logging

from .models import ModelInfo, Resolution
from .ports import IModelRegistry

logger = logging.getLogger("jart.routing")


def select_target(models: list[ModelInfo], requested: str | None) -> Resolution:
    """Pure model-selection policy. No I/O, no side effects.

    - Explicit `requested` model: must exist and be running, else a typed error
      (404 if unknown, 503 if known but not running). No silent re-routing.
    - No `requested`: fall back to the first running chat model.
    """
    chat_models = [m for m in models if (m.type or "chat") == "chat"]

    if requested:
        match = next((m for m in chat_models if m.name == requested), None)
        if match is None:
            return Resolution(None, f"model '{requested}' not found in registry", 404)
        if not match.is_running:
            return Resolution(
                None, f"model '{requested}' is not running (status: {match.status})", 503
            )
        return Resolution(match)

    running = [m for m in chat_models if m.is_running]
    if not running:
        return Resolution(None, "no running chat model available", 503)
    return Resolution(running[0])


class RoutingService:
    """Resolves an incoming request body to a concrete model target."""

    def __init__(self, registry: IModelRegistry) -> None:
        self._registry = registry

    async def resolve(self, body: dict) -> Resolution:
        requested = body.get("model")
        try:
            models = await self._registry.list_models()
        except Exception as e:  # registry unreachable -> cannot route
            logger.warning("Control Plane registry unavailable: %s", e)
            return Resolution(None, f"control plane registry unavailable: {e}", 503)
        return select_target(models, requested)
