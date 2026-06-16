"""Domain models for the enrichment subsystem."""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, field


@dataclass
class MemoryFact:
    content: str
    score: float
    layer: int
    source: str
    memory_id: str = ""
    created_at: str = ""
    metadata: dict = field(default_factory=dict)


@dataclass
class MemoryResult:
    facts: list[MemoryFact] = field(default_factory=list)
    injection_text: str = ""
    token_estimate: int = 0
    retrieved_at: float = field(default_factory=time.time)
    latency_ms: float = 0.0

    @property
    def has_context(self) -> bool:
        return bool(self.facts)

    @classmethod
    def empty(cls) -> MemoryResult:
        return cls()


@dataclass
class EnrichmentConfig:
    enabled: bool = True
    memory_url: str = "http://localhost:8890"
    token_budget: int = 2000
    min_score: float = 0.65
    timeout_ms: int = 500
    cache_ttl_s: int = 60
    injection_style: str = "block"
    skip_agent_ids: list[str] = field(default_factory=list)

    @classmethod
    def from_env(cls) -> EnrichmentConfig:
        return cls(
            enabled=os.getenv("ENRICHMENT_ENABLED", "true").lower() == "true",
            memory_url=os.getenv("ENRICHMENT_MEMORY_URL", "http://localhost:8890"),
            token_budget=int(os.getenv("ENRICHMENT_TOKEN_BUDGET", "2000")),
            min_score=float(os.getenv("ENRICHMENT_MIN_SCORE", "0.65")),
            timeout_ms=int(os.getenv("ENRICHMENT_TIMEOUT_MS", "500")),
            cache_ttl_s=int(os.getenv("ENRICHMENT_CACHE_TTL_S", "60")),
            skip_agent_ids=[
                s for s in os.getenv("ENRICHMENT_SKIP_AGENT_IDS", "").split(",") if s
            ],
        )
