"""Factory that builds EnrichmentService from environment variables."""
from __future__ import annotations

from .adapters.extraction.message import MessageContextExtractor
from .adapters.memory.backpack import BackpackMemoryAdapter
from .core.models import EnrichmentConfig
from .core.service import EnrichmentService


def build_enrichment_service(config: EnrichmentConfig | None = None) -> EnrichmentService:
    """Build enrichment service from env vars.

    Phase A: ENRICHMENT_MEMORY_URL -> http://localhost:8890 (Backpack API)
    Phase B: ENRICHMENT_MEMORY_URL -> http://localhost:8891 (Jart-Core-Memory)
    """
    cfg = config or EnrichmentConfig.from_env()
    retriever = BackpackMemoryAdapter(backpack_url=cfg.memory_url, config=cfg)
    extractor = MessageContextExtractor()
    return EnrichmentService(retriever=retriever, extractor=extractor, config=cfg)
