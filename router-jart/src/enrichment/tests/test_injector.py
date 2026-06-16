"""Tests for SystemPromptInjector."""
import pytest

from ..adapters.injection.system_prompt import SystemPromptInjector
from ..core.models import MemoryFact, MemoryResult


def test_inject_prepends_to_system_prompt():
    inj = SystemPromptInjector()
    facts = [MemoryFact(content="Router on :10200", score=0.9, layer=3, source="test")]
    result = MemoryResult(facts=facts, injection_text="[JART-MEMORY: Router on :10200\n[/JART-MEMORY]")

    msgs = [
        {"role": "system", "content": "You are helpful."},
        {"role": "user", "content": "What port?"},
    ]
    enriched = inj.inject(msgs, result)
    assert "[JART-MEMORY:" in enriched[0]["content"]
    assert "You are helpful." in enriched[0]["content"]


def test_inject_creates_system_prompt_if_missing():
    inj = SystemPromptInjector()
    facts = [MemoryFact(content="Fact", score=0.9, layer=3, source="test")]
    result = MemoryResult(facts=facts, injection_text="[JART-MEMORY: Fact\n[/JART-MEMORY]")

    msgs = [{"role": "user", "content": "Hello"}]
    enriched = inj.inject(msgs, result)
    assert enriched[0]["role"] == "system"
    assert "[JART-MEMORY:" in enriched[0]["content"]


def test_inject_idempotent():
    inj = SystemPromptInjector()
    facts = [MemoryFact(content="Fact", score=0.9, layer=3, source="test")]
    result = MemoryResult(facts=facts, injection_text="[JART-MEMORY: Fact\n[/JART-MEMORY]")

    msgs = [
        {"role": "system", "content": "[JART-MEMORY: already here\n[/JART-MEMORY]\nYou are helpful."},
        {"role": "user", "content": "Hello"},
    ]
    enriched = inj.inject(msgs, result)
    assert enriched == msgs  # unchanged


def test_inject_empty_facts():
    inj = SystemPromptInjector()
    result = MemoryResult.empty()
    msgs = [{"role": "user", "content": "Hello"}]
    enriched = inj.inject(msgs, result)
    assert enriched == msgs
