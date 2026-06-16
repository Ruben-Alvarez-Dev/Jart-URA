"""Shared fixtures for enrichment tests."""
import pytest

from ..adapters.injection.noop import NoopInjector
from ..adapters.injection.system_prompt import SystemPromptInjector
from ..adapters.memory.null import NullMemoryAdapter
from ..core.models import EnrichmentConfig


@pytest.fixture
def config():
    return EnrichmentConfig(
        enabled=True,
        memory_url="http://localhost:8890",
        token_budget=2000,
        min_score=0.65,
        timeout_ms=500,
    )


@pytest.fixture
def disabled_config():
    return EnrichmentConfig(enabled=False)


@pytest.fixture
def null_retriever():
    return NullMemoryAdapter()


@pytest.fixture
def null_retriever_unhealthy():
    return NullMemoryAdapter(healthy=False)


@pytest.fixture
def injector():
    return SystemPromptInjector()


@pytest.fixture
def noop_injector():
    return NoopInjector()
