"""Extracts semantic signal from OpenAI message arrays."""
from __future__ import annotations

import re

from ...core.ports import IContextExtractor

_ENTITY_RE = re.compile(
    r"\b(Jart[-\w]*|MCP[-\w]*|vLLM|LiteLLM|Qdrant|llama[-\w]*|bge[-\w]*|"
    r"Engram|Backpack|FastAPI|Docker|launchd|Cursor|Windsurf|Claude)\b",
    re.IGNORECASE,
)


class MessageContextExtractor(IContextExtractor):
    """Extracts semantic signal from OpenAI messages.

    Strategy by layers:
    1. Last user message (always)
    2. Technical entities from system prompt (if present)
    3. Sliding window of last N turns (summary)

    Max output: 512 tokens (~2048 chars).
    """

    def __init__(self, window: int = 3, max_chars: int = 2048) -> None:
        self._window = window
        self._max_chars = max_chars

    def extract(self, messages: list[dict]) -> str:
        parts = []

        last_user = self._last_user_message(messages)
        if last_user:
            parts.append(last_user)

        system_entities = self._extract_system_entities(messages)
        if system_entities:
            parts.append(f"contexto: {system_entities}")

        recent = self._recent_context(messages)
        if recent:
            parts.append(recent)

        combined = " | ".join(p for p in parts if p)
        return combined[: self._max_chars]

    def _last_user_message(self, messages: list[dict]) -> str:
        for msg in reversed(messages):
            if msg.get("role") == "user":
                return (msg.get("content") or "")[:512]
        return ""

    def _extract_system_entities(self, messages: list[dict]) -> str:
        for msg in messages:
            if msg.get("role") == "system":
                content = msg.get("content") or ""
                entities = _ENTITY_RE.findall(content)
                if entities:
                    return " ".join(set(entities))[:256]
        return ""

    def _recent_context(self, messages: list[dict]) -> str:
        recent = [
            m for m in messages[-self._window * 2:]
            if m.get("role") in ("user", "assistant")
        ][-self._window:]
        if len(recent) < 2:
            return ""
        pairs = []
        for m in recent:
            role = "U" if m["role"] == "user" else "A"
            content = (m.get("content") or "")[:100]
            pairs.append(f"{role}: {content}")
        return " | ".join(pairs)[:512]
