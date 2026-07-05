"""Streaming chat forwarder (HTTP)."""
from __future__ import annotations

import httpx

from ...core.models import ModelInfo, UpstreamResponse
from ...core.ports import IChatForwarder

# Hop-by-hop and body-framing headers that must not be copied upstream.
_EXCLUDED_REQUEST_HEADERS = {"host", "content-length", "content-type", "connection"}


class HttpStreamForwarder(IChatForwarder):
    """Forwards the already-enriched request body to a model endpoint and
    streams the response back transparently (status and content-type preserved)."""

    def __init__(self, client: httpx.AsyncClient) -> None:
        self._client = client

    async def forward(
        self, target: ModelInfo, body: dict, headers: dict[str, str]
    ) -> UpstreamResponse:
        forward_headers = {
            key: value
            for key, value in headers.items()
            if key.lower() not in _EXCLUDED_REQUEST_HEADERS
        }
        request = self._client.build_request(
            "POST", target.chat_completions_url, json=body, headers=forward_headers
        )
        response = await self._client.send(request, stream=True)
        media_type = (
            response.headers.get("content-type", "application/json").split(";")[0].strip()
        )
        return UpstreamResponse(
            status_code=response.status_code,
            media_type=media_type,
            body=response.aiter_bytes(),
            aclose=response.aclose,
        )
