"""Null memory adapter for testing. Always returns empty."""
from __future__ import annotations

from ...core.models import MemoryResult
from ...core.ports import IMemoryRetriever


class NullMemoryAdapter(IMemoryRetriever):
    """Returns no memory. Used in unit tests."""

    def __init__(self, *, healthy: bool = True):
        self._healthy = healthy

    async def query(
        self,
        query: str,
        agent_id: str = "shared",
        token_budget: int = 2000,
        timeout_ms: int = 500,
    ) -> MemoryResult:
        return MemoryResult.empty()

    async def health(self) -> bool:
        return self._healthy
