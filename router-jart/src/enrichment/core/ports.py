"""Ports (interfaces) for the enrichment domain.

Rules:
- No adapter imports concrete implementations beyond the type.
- No service imports concrete implementations.
- All methods async to avoid blocking the server event loop.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from .models import MemoryResult


class IMemoryRetriever(ABC):
    """Retrieves memory facts relevant to a query."""

    @abstractmethod
    async def query(
        self,
        query: str,
        agent_id: str = "shared",
        token_budget: int = 2000,
        timeout_ms: int = 500,
    ) -> MemoryResult:
        """
        Contract:
        - NEVER raises. On error returns empty MemoryResult.
        - Respects timeout_ms as hard limit.
        - Filters results with score < config.min_score.
        """
        ...

    @abstractmethod
    async def health(self) -> bool:
        """True if the memory backend is reachable."""
        ...


class IContextExtractor(ABC):
    """Extracts semantic signal from an array of messages."""

    @abstractmethod
    def extract(self, messages: list[dict]) -> str:
        """
        Input:  OpenAI-format messages [{"role": str, "content": str}]
        Output: semantic string for use as query. Empty if not extractable.
        Max 512 tokens output.
        """
        ...
