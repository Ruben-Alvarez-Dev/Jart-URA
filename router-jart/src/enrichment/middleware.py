"""FastAPI ASGI middleware for transparent memory enrichment."""
from __future__ import annotations

import json
import logging
import time

from .core.models import EnrichmentConfig
from .core.service import EnrichmentService

logger = logging.getLogger("jart.enrichment.middleware")

CHAT_COMPLETIONS_PATH = "/v1/chat/completions"


class EnrichmentMiddleware:
    """ASGI middleware. Intercepts POST /v1/chat/completions and enriches messages.

    Behavior:
    - Only acts on POST to CHAT_COMPLETIONS_PATH
    - Does not act on /v1/embeddings, /v1/models, etc.
    - If enrichment fails -> passes original request unchanged
    - If agent-id is in skip_agent_ids -> passes without enriching
    """

    def __init__(self, app, service: EnrichmentService, config: EnrichmentConfig):
        self.app = app
        self._service = service
        self._config = config

    async def __call__(self, scope, receive, send):
        if not self._should_intercept(scope):
            await self.app(scope, receive, send)
            return

        try:
            body = await self._read_body(receive)
            agent_id = body.get("user", "shared") or "shared"

            if agent_id in self._config.skip_agent_ids:
                await self.app(scope, self._make_receiver(body), send)
                return

            messages = body.get("messages", [])
            enriched_messages, result = await self._service.enrich(messages)

            if result.has_context:
                body = {**body, "messages": enriched_messages}
                logger.debug(
                    "Enriched request: %d facts, %.1fms, %d tokens",
                    len(result.facts), result.latency_ms, result.token_estimate,
                )

            await self.app(scope, self._make_receiver(body), send)

        except Exception as e:
            logger.warning("Middleware error, passing through: %s", e)
            await self.app(scope, receive, send)

    def _should_intercept(self, scope) -> bool:
        if scope.get("type") != "http":
            return False
        if scope.get("method") != "POST":
            return False
        path = scope.get("path", "")
        return path == CHAT_COMPLETIONS_PATH or path.endswith(CHAT_COMPLETIONS_PATH)

    async def _read_body(self, receive) -> dict:
        chunks = []
        while True:
            event = await receive()
            if event["type"] == "http.request":
                chunks.append(event.get("body", b""))
                if not event.get("more_body", False):
                    break
        return json.loads(b"".join(chunks))

    def _make_receiver(self, body: dict):
        raw = json.dumps(body).encode()
        sent = False

        async def receiver():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": raw, "more_body": False}
            return {"type": "http.disconnect"}

        return receiver
