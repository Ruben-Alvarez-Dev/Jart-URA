"""No-op injector for testing. Passes through unchanged."""
from __future__ import annotations

from ...core.models import MemoryResult


class NoopInjector:
    """Returns messages unchanged. Used in unit tests."""

    def inject(self, messages: list[dict], result: MemoryResult) -> list[dict]:
        return messages
