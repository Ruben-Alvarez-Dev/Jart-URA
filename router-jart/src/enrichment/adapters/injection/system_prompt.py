"""System prompt injector. Prepends [JART-MEMORY] block."""
from __future__ import annotations

from ...core.models import MemoryResult

MARKER_START = "[JART-MEMORY:"
MARKER_END = "[/JART-MEMORY]"


class SystemPromptInjector:
    """Prepends memory block to system prompt. Idempotent."""

    def inject(self, messages: list[dict], result: MemoryResult) -> list[dict]:
        if not result.has_context:
            return messages
        if self._already_injected(messages):
            return messages
        return self._prepend(messages, self._format(result))

    def _already_injected(self, messages: list[dict]) -> bool:
        for msg in messages:
            if msg.get("role") == "system" and MARKER_START in (msg.get("content") or ""):
                return True
        return False

    def _format(self, result: MemoryResult) -> str:
        lines = [f"{MARKER_START} contexto semánticamente relevante]"]
        for f in result.facts:
            lines.append(f"• [L{f.layer}/{f.score:.2f}] {f.content}")
        lines.append(MARKER_END)
        return "\n".join(lines)

    def _prepend(self, messages: list[dict], injection_text: str) -> list[dict]:
        messages = list(messages)
        for i, msg in enumerate(messages):
            if msg.get("role") == "system":
                messages[i] = {
                    **msg,
                    "content": f"{injection_text}\n\n{msg['content']}",
                }
                return messages
        return [{"role": "system", "content": injection_text}] + messages
