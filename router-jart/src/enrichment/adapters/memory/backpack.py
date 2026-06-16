"""Backpack API memory adapter. HTTP POST to :8890/api/request-context."""
from __future__ import annotations

import asyncio
import json
import logging
import time
import urllib.request

from ...core.models import EnrichmentConfig, MemoryFact, MemoryResult
from ...core.ports import IMemoryRetriever

logger = logging.getLogger("jart.enrichment.backpack")


class BackpackMemoryAdapter(IMemoryRetriever):
    """Queries the Backpack HTTP API from MCP-agent-memory.

    Phase A: no changes to MCP. Phase B: this adapter points to jart-core-memory.
    """

    def __init__(self, backpack_url: str = "http://localhost:8890", config: EnrichmentConfig | None = None):
        self._url = backpack_url.rstrip("/")
        self._config = config or EnrichmentConfig()

    async def query(
        self,
        query: str,
        agent_id: str = "shared",
        token_budget: int = 2000,
        timeout_ms: int = 500,
    ) -> MemoryResult:
        t0 = time.perf_counter()
        try:
            payload = json.dumps({
                "query": query,
                "agent_id": agent_id,
                "token_budget": token_budget,
            }).encode()

            req = urllib.request.Request(
                f"{self._url}/api/request-context",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )

            timeout_s = timeout_ms / 1000
            loop = asyncio.get_event_loop()
            raw = await asyncio.wait_for(
                loop.run_in_executor(None, lambda: self._do_request(req)),
                timeout=timeout_s,
            )

            latency_ms = (time.perf_counter() - t0) * 1000
            return self._parse(raw, latency_ms)

        except asyncio.TimeoutError:
            logger.debug("Backpack API timeout after %dms", timeout_ms)
            return MemoryResult.empty()
        except Exception as e:
            logger.debug("Backpack API error: %s", e)
            return MemoryResult.empty()

    def _do_request(self, req) -> dict:
        with urllib.request.urlopen(req, timeout=1.0) as r:
            return json.loads(r.read())

    def _parse(self, raw: dict, latency_ms: float) -> MemoryResult:
        try:
            pack = raw.get("context_pack", {}) or {}
            injection = raw.get("injection_text", "") or pack.get("summary", "")
            sources = pack.get("sources", []) or []

            facts = [
                MemoryFact(
                    content=s.get("content_preview", ""),
                    score=s.get("score", 0.0),
                    layer=s.get("layer", 0),
                    source=s.get("scope", ""),
                )
                for s in sources
                if s.get("score", 0) >= self._config.min_score
            ]

            return MemoryResult(
                facts=facts,
                injection_text=injection,
                token_estimate=len(injection) // 4,
                latency_ms=latency_ms,
            )
        except Exception as e:
            logger.debug("Backpack parse error: %s", e)
            return MemoryResult.empty()

    async def health(self) -> bool:
        try:
            req = urllib.request.Request(f"{self._url}/api/health")
            loop = asyncio.get_event_loop()
            await asyncio.wait_for(
                loop.run_in_executor(None, lambda: urllib.request.urlopen(req, timeout=1.0)),
                timeout=1.0,
            )
            return True
        except Exception:
            return False
