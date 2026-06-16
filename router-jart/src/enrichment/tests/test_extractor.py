"""Tests for MessageContextExtractor."""
import pytest

from ..adapters.extraction.message import MessageContextExtractor


def test_extract_single_user_message():
    ext = MessageContextExtractor()
    result = ext.extract([{"role": "user", "content": "What is Jart-URA?"}])
    assert "Jart-URA" in result


def test_extract_with_system_entities():
    ext = MessageContextExtractor()
    msgs = [
        {"role": "system", "content": "You use Qdrant and LiteLLM for routing."},
        {"role": "user", "content": "Check the config"},
    ]
    result = ext.extract(msgs)
    assert "Qdrant" in result or "LiteLLM" in result


def test_extract_with_conversation_history():
    ext = MessageContextExtractor()
    msgs = [
        {"role": "user", "content": "What is Jart?"},
        {"role": "assistant", "content": "Jart is a model router."},
        {"role": "user", "content": "Show me the ports"},
    ]
    result = ext.extract(msgs)
    assert len(result) > 0


def test_extract_empty_messages():
    ext = MessageContextExtractor()
    result = ext.extract([])
    assert result == ""


def test_extract_max_chars_respected():
    ext = MessageContextExtractor(max_chars=50)
    long_msg = "x" * 1000
    result = ext.extract([{"role": "user", "content": long_msg}])
    assert len(result) <= 50
