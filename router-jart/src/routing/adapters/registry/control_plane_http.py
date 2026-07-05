"""Control Plane registry adapter (HTTP)."""
from __future__ import annotations

import httpx

from ...core.models import ModelInfo
from ...core.ports import IModelRegistry


class ControlPlaneRegistry(IModelRegistry):
    """Reads models from the Control Plane `GET /v1/registry` projection.

    The projection shape is `{hostname, local[], peered[], peers, unified[]}`.
    The MVP routes only to local models; peered routing is deferred.
    """

    def __init__(self, client: httpx.AsyncClient, base_url: str) -> None:
        self._client = client
        self._base_url = base_url.rstrip("/")

    async def list_models(self) -> list[ModelInfo]:
        response = await self._client.get(f"{self._base_url}/v1/registry")
        response.raise_for_status()
        payload = response.json()
        return [self._to_model(raw) for raw in payload.get("local", [])]

    @staticmethod
    def _to_model(raw: dict) -> ModelInfo:
        return ModelInfo(
            name=raw["name"],
            port=int(raw["port"]),
            type=raw.get("type", "chat"),
            status=raw.get("status", "stopped"),
            source=raw.get("source", "local"),
        )
