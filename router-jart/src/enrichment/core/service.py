"""Enrichment orchestrator. No network logic, no parsing."""
from __future__ import annotations

import logging
import time

from .models import EnrichmentConfig, MemoryResult
from .ports import IContextExtractor, IMemoryRetriever

logger = logging.getLogger("jart.enrichment")

MEMORY_MARKER = "[JART-MEMORY:"
MEMORY_MARKER_END = "[/JART-MEMORY]"


class EnrichmentService:
    """Orchestrates extract -> retrieve -> inject. NEVER raises."""

    def __init__(
        self,
        retriever: IMemoryRetriever,
        extractor: IContextExtractor,
        config: EnrichmentConfig,
    ) -> None:
        self._retriever = retriever
        self._extractor = extractor
        self._config = config

    async def enrich(self, messages: list[dict]) -> tuple[list[dict], MemoryResult]:
        """Enrich messages with memory context.

        Returns (enriched_messages, memory_result).
        If not enriched, returns (original_messages, MemoryResult.empty()).
        NEVER raises.
        """
        if not self._config.enabled:
            return messages, MemoryResult.empty()

        if not messages:
            return messages, MemoryResult.empty()

        if self._already_has_memory(messages):
            return messages, MemoryResult.empty()

        try:
            t0 = time.perf_counter()
            query = self._extractor.extract(messages)
            if not query or len(query) < 10:
                return messages, MemoryResult.empty()

            result = await self._retriever.query(
                query=query,
                token_budget=self._config.token_budget,
                timeout_ms=self._config.timeout_ms,
            )
            result.latency_ms = (time.perf_counter() - t0) * 1000

            if not result.has_context:
                return messages, result

            enriched = self._inject(messages, result.injection_text)
            return enriched, result

        except Exception as e:
            logger.warning("Enrichment failed silently: %s", e)
            return messages, MemoryResult.empty()

    def _already_has_memory(self, messages: list[dict]) -> bool:
        for msg in messages:
            if msg.get("role") == "system" and MEMORY_MARKER in (msg.get("content") or ""):
                return True
        return False

    def _inject(self, messages: list[dict], injection_text: str) -> list[dict]:
        """Prepend memory block to system prompt."""
        messages = list(messages)  # don't mutate original
        for i, msg in enumerate(messages):
            if msg.get("role") == "system":
                messages[i] = {
                    **msg,
                    "content": f"{injection_text}\n\n{msg['content']}",
                }
                return messages
        # No system prompt -> create one
        return [{"role": "system", "content": injection_text}] + messages
