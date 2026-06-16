"""Tests for EnrichmentService."""
import pytest

from ..adapters.extraction.message import MessageContextExtractor
from ..adapters.memory.null import NullMemoryAdapter
from ..core.models import EnrichmentConfig, MemoryFact, MemoryResult
from ..core.ports import IMemoryRetriever
from ..core.service import EnrichmentService


class FakeRetriever(IMemoryRetriever):
    """Returns pre-set results for testing."""

    def __init__(self, result: MemoryResult | None = None, *, raise_on_query: bool = False):
        self._result = result or MemoryResult.empty()
        self._raise = raise_on_query
        self.queries: list[str] = []

    async def query(self, query: str, agent_id: str = "shared", token_budget: int = 2000, timeout_ms: int = 500) -> MemoryResult:
        self.queries.append(query)
        if self._raise:
            raise RuntimeError("memory backend down")
        return self._result

    async def health(self) -> bool:
        return not self._raise


def _make_service(retriever=None, config=None, extractor=None):
    cfg = config or EnrichmentConfig(enabled=True, min_score=0.0)
    ret = retriever or NullMemoryAdapter()
    ext = extractor or MessageContextExtractor()
    return EnrichmentService(retriever=ret, extractor=ext, config=cfg)


@pytest.mark.asyncio
async def test_enrich_empty_messages():
    svc = _make_service()
    msgs, result = await svc.enrich([])
    assert msgs == []
    assert not result.has_context


@pytest.mark.asyncio
async def test_enrich_disabled_config():
    svc = _make_service(config=EnrichmentConfig(enabled=False))
    msgs, result = await svc.enrich([{"role": "user", "content": "hello"}])
    assert len(msgs) == 1
    assert not result.has_context


@pytest.mark.asyncio
async def test_enrich_already_has_memory():
    svc = _make_service()
    msgs = [
        {"role": "system", "content": "[JART-MEMORY: something]\n[/JART-MEMORY]\nYou are helpful."},
        {"role": "user", "content": "hello"},
    ]
    result_msgs, result = await svc.enrich(msgs)
    assert result_msgs == msgs
    assert not result.has_context


@pytest.mark.asyncio
async def test_enrich_with_relevant_memory():
    facts = [MemoryFact(content="Router is on :10200", score=0.9, layer=3, source="test")]
    result = MemoryResult(facts=facts, injection_text="[JART-MEMORY: Router is on :10200\n[/JART-MEMORY]")
    retriever = FakeRetriever(result)
    svc = _make_service(retriever=retriever)

    msgs = [
        {"role": "system", "content": "You are helpful."},
        {"role": "user", "content": "What port is the router on?"},
    ]
    enriched, res = await svc.enrich(msgs)
    assert res.has_context
    assert "[JART-MEMORY:" in enriched[0]["content"]
    assert len(retriever.queries) == 1


@pytest.mark.asyncio
async def test_enrich_retriever_throws():
    retriever = FakeRetriever(raise_on_query=True)
    svc = _make_service(retriever=retriever)
    msgs = [{"role": "user", "content": "What is the router config?"}]
    result_msgs, result = await svc.enrich(msgs)
    assert result_msgs == msgs
    assert not result.has_context


@pytest.mark.asyncio
async def test_enrich_short_query_skipped():
    svc = _make_service()
    msgs = [{"role": "user", "content": "hi"}]
    result_msgs, result = await svc.enrich(msgs)
    assert result_msgs == msgs
    assert not result.has_context
