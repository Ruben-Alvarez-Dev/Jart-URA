# Fase A — Quick Win: EnrichmentMiddleware sobre Backpack API

> **Objetivo**: Inyección automática funcionando en 3-4 días, sin modificar MCP-agent-memory  
> **Prerrequisitos**: Fase 0 completada, Backpack API (:8890) respondiendo  
> **Resultado**: Memoria inyectada en Claude Code y clientes HTTP automáticamente

---

## Estructura de código a crear

```
Jart-OS/TIERS/TIER-02-GATEWAY/10200-router-jart/src/
└── enrichment/
    ├── __init__.py
    ├── core/
    │   ├── __init__.py
    │   ├── ports.py          ← interfaces (ABCs)
    │   ├── models.py         ← dataclasses de dominio
    │   └── service.py        ← EnrichmentService
    ├── adapters/
    │   ├── __init__.py
    │   ├── memory/
    │   │   ├── __init__.py
    │   │   ├── backpack.py   ← BackpackMemoryAdapter (Fase A)
    │   │   └── null.py       ← NullMemoryAdapter (tests)
    │   ├── extraction/
    │   │   ├── __init__.py
    │   │   └── message.py    ← MessageContextExtractor
    │   └── injection/
    │       ├── __init__.py
    │       ├── system_prompt.py  ← SystemPromptInjector
    │       └── noop.py           ← NoopInjector (tests)
    ├── middleware.py         ← FastAPI ASGI middleware
    ├── factory.py            ← build_enrichment_service()
    └── tests/
        ├── __init__.py
        ├── conftest.py
        ├── test_service.py
        ├── test_backpack_adapter.py
        ├── test_extractor.py
        ├── test_injector.py
        └── test_middleware.py
```

---

## A.1 — core/ports.py

```python
"""Puertos (interfaces) del dominio de enriquecimiento.

Reglas:
- NINGÚN adaptador importa directamente de aquí más allá del tipo.
- NINGÚN servicio importa implementaciones concretas.
- Todos los métodos async para no bloquear el event loop del servidor.
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from .models import MemoryResult, EnrichmentConfig


class IMemoryRetriever(ABC):
    """Recupera hechos de memoria relevantes para una query."""

    @abstractmethod
    async def query(
        self,
        query: str,
        agent_id: str = "shared",
        token_budget: int = 2000,
        timeout_ms: int = 500,
    ) -> MemoryResult:
        """
        Contrato:
        - NUNCA lanza excepción. En caso de error devuelve MemoryResult vacío.
        - Respeta el timeout_ms como límite duro.
        - Filtra resultados con score < config.min_score.
        """
        ...

    @abstractmethod
    async def health(self) -> bool:
        """True si el backend de memoria está accesible."""
        ...


class IContextExtractor(ABC):
    """Extrae la señal semántica de un array de mensajes."""

    @abstractmethod
    def extract(self, messages: list[dict]) -> str:
        """
        Input:  lista de mensajes OpenAI [{"role": str, "content": str}]
        Output: string semántico para usar como query. Vacío si no extraíble.
        Máximo 512 tokens de output.
        """
        ...
```

---

## A.2 — core/models.py

```python
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
import os
import time


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
    def empty(cls) -> "MemoryResult":
        return cls()


@dataclass
class EnrichmentConfig:
    enabled: bool = True
    memory_url: str = "http://localhost:8890"  # Fase A: Backpack API
    token_budget: int = 2000
    min_score: float = 0.65
    timeout_ms: int = 500
    cache_ttl_s: int = 60
    injection_style: str = "block"
    skip_agent_ids: list[str] = field(default_factory=list)

    @classmethod
    def from_env(cls) -> "EnrichmentConfig":
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
```

---

## A.3 — core/service.py

```python
from __future__ import annotations
import asyncio
import logging
import time

from .ports import IMemoryRetriever, IContextExtractor
from .models import EnrichmentConfig, MemoryResult

logger = logging.getLogger("jart.enrichment")

MEMORY_MARKER = "[JART-MEMORY:"
MEMORY_MARKER_END = "[/JART-MEMORY]"


class EnrichmentService:
    """
    Orquestador del enriquecimiento. No contiene lógica de red ni de parsing.
    Solo coordina extractor → retriever → injector.
    """

    def __init__(
        self,
        retriever: IMemoryRetriever,
        extractor: IContextExtractor,
        config: EnrichmentConfig,
    ) -> None:
        self._retriever = retriever
        self._extractor = extractor
        self._config = config

    async def enrich(self, messages: list[dict]) -> tuple[list[dict], MemoryResult]:
        """
        Enriquece los mensajes con contexto de memoria.

        Returns: (messages_enriquecidos, memory_result)
        - Si no se enriquece, devuelve (messages_original, MemoryResult.empty())
        - NUNCA lanza excepción.
        """
        if not self._config.enabled:
            return messages, MemoryResult.empty()

        if not messages:
            return messages, MemoryResult.empty()

        if self._already_has_memory(messages):
            return messages, MemoryResult.empty()

        try:
            query = self._extractor.extract(messages)
            if not query or len(query) < 10:
                return messages, MemoryResult.empty()

            result = await self._retriever.query(
                query=query,
                token_budget=self._config.token_budget,
                timeout_ms=self._config.timeout_ms,
            )

            if not result.has_context:
                return messages, result

            enriched = self._inject(messages, result.injection_text)
            return enriched, result

        except Exception as e:
            logger.warning("Enrichment failed silently: %s", e)
            return messages, MemoryResult.empty()

    def _already_has_memory(self, messages: list[dict]) -> bool:
        for msg in messages:
            if msg.get("role") == "system" and MEMORY_MARKER in (msg.get("content") or ""):
                return True
        return False

    def _inject(self, messages: list[dict], injection_text: str) -> list[dict]:
        """Prepend el bloque de memoria al system prompt."""
        messages = list(messages)  # no mutar el original
        for i, msg in enumerate(messages):
            if msg.get("role") == "system":
                messages[i] = {
                    **msg,
                    "content": f"{injection_text}\n\n{msg['content']}",
                }
                return messages
        # No hay system prompt → crear uno
        return [{"role": "system", "content": injection_text}] + messages
```

---

## A.4 — adapters/memory/backpack.py

```python
from __future__ import annotations
import asyncio
import json
import logging
import time
import urllib.request
from ..core.ports import IMemoryRetriever
from ..core.models import MemoryFact, MemoryResult, EnrichmentConfig

logger = logging.getLogger("jart.enrichment.backpack")


class BackpackMemoryAdapter(IMemoryRetriever):
    """
    Consulta el Backpack API HTTP de MCP-agent-memory.
    Endpoint: POST {backpack_url}/api/request-context

    Fase A: sin cambios al MCP. Fase B: este adaptador apuntará a jart-core-memory.
    """

    def __init__(self, backpack_url: str = "http://localhost:8890", config: EnrichmentConfig | None = None):
        self._url = backpack_url.rstrip("/")
        self._config = config or EnrichmentConfig()

    async def query(
        self,
        query: str,
        agent_id: str = "shared",
        token_budget: int = 2000,
        timeout_ms: int = 500,
    ) -> MemoryResult:
        t0 = time.perf_counter()
        try:
            # urllib para no añadir dependencias en Fase A
            payload = json.dumps({
                "query": query,
                "agent_id": agent_id,
                "token_budget": token_budget,
            }).encode()

            req = urllib.request.Request(
                f"{self._url}/api/request-context",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )

            timeout_s = timeout_ms / 1000
            loop = asyncio.get_event_loop()
            raw = await asyncio.wait_for(
                loop.run_in_executor(None, lambda: self._do_request(req)),
                timeout=timeout_s,
            )

            latency_ms = (time.perf_counter() - t0) * 1000
            return self._parse(raw, latency_ms)

        except asyncio.TimeoutError:
            logger.debug("Backpack API timeout after %dms", timeout_ms)
            return MemoryResult.empty()
        except Exception as e:
            logger.debug("Backpack API error: %s", e)
            return MemoryResult.empty()

    def _do_request(self, req) -> dict:
        with urllib.request.urlopen(req, timeout=1.0) as r:
            return json.loads(r.read())

    def _parse(self, raw: dict, latency_ms: float) -> MemoryResult:
        try:
            # El Backpack API devuelve context_pack con summary e injection_text
            pack = raw.get("context_pack", {}) or {}
            injection = raw.get("injection_text", "") or pack.get("summary", "")
            sources = pack.get("sources", []) or []

            facts = [
                MemoryFact(
                    content=s.get("content_preview", ""),
                    score=s.get("score", 0.0),
                    layer=s.get("layer", 0),
                    source=s.get("scope", ""),
                )
                for s in sources
                if s.get("score", 0) >= self._config.min_score
            ]

            return MemoryResult(
                facts=facts,
                injection_text=injection,
                token_estimate=len(injection) // 4,
                latency_ms=latency_ms,
            )
        except Exception as e:
            logger.debug("Backpack parse error: %s", e)
            return MemoryResult.empty()

    async def health(self) -> bool:
        try:
            req = urllib.request.Request(f"{self._url}/api/health")
            loop = asyncio.get_event_loop()
            await asyncio.wait_for(
                loop.run_in_executor(None, lambda: urllib.request.urlopen(req, timeout=1.0)),
                timeout=1.0,
            )
            return True
        except Exception:
            return False
```

---

## A.5 — adapters/extraction/message.py

```python
from __future__ import annotations
import re
from ..core.ports import IContextExtractor

_ENTITY_RE = re.compile(
    r"\b(Jart[-\w]*|MCP[-\w]*|vLLM|LiteLLM|Qdrant|llama[-\w]*|bge[-\w]*|"
    r"Engram|Backpack|FastAPI|Docker|launchd|Cursor|Windsurf|Claude)\b",
    re.IGNORECASE,
)


class MessageContextExtractor(IContextExtractor):
    """
    Extrae la señal semántica de un array de mensajes OpenAI.

    Estrategia por capas:
    1. Último mensaje del usuario (siempre)
    2. Entidades técnicas del system prompt (si existen)
    3. Sliding window de los últimos N turnos (resumen)

    Output máximo: 512 tokens (~2048 chars).
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
```

---

## A.6 — factory.py

```python
"""
Factory que construye el EnrichmentService desde variables de entorno.
Punto único de configuración para ambas fases (A y B).
"""
from __future__ import annotations
import os
from .core.models import EnrichmentConfig
from .core.service import EnrichmentService
from .adapters.memory.backpack import BackpackMemoryAdapter
from .adapters.extraction.message import MessageContextExtractor


def build_enrichment_service(config: EnrichmentConfig | None = None) -> EnrichmentService:
    """
    Construye el servicio de enriquecimiento desde env vars.

    En Fase A: ENRICHMENT_MEMORY_URL apunta a http://localhost:8890 (Backpack API)
    En Fase B: ENRICHMENT_MEMORY_URL apunta a http://localhost:8891 (Jart-Core-Memory)
    """
    cfg = config or EnrichmentConfig.from_env()
    retriever = BackpackMemoryAdapter(backpack_url=cfg.memory_url, config=cfg)
    extractor = MessageContextExtractor()
    return EnrichmentService(retriever=retriever, extractor=extractor, config=cfg)
```

---

## A.7 — middleware.py

```python
"""FastAPI ASGI middleware para inyección transparente de contexto de memoria."""
from __future__ import annotations
import json
import logging
import time

from .core.service import EnrichmentService
from .core.models import EnrichmentConfig

logger = logging.getLogger("jart.enrichment.middleware")

CHAT_COMPLETIONS_PATH = "/v1/chat/completions"


class EnrichmentMiddleware:
    """
    ASGI middleware. Intercepta POST /v1/chat/completions y enriquece los messages.

    Comportamiento:
    - Solo actúa en POST a CHAT_COMPLETIONS_PATH
    - No actúa en /v1/embeddings, /v1/models, etc.
    - Si el enriquecimiento falla → pasa la request original sin modificar
    - Si el agent-id está en skip_agent_ids → pasa sin enriquecer
    """

    def __init__(self, app, service: EnrichmentService, config: EnrichmentConfig):
        self.app = app
        self._service = service
        self._config = config

    async def __call__(self, scope, receive, send):
        if not self._should_intercept(scope):
            await self.app(scope, receive, send)
            return

        try:
            body = await self._read_body(receive)
            agent_id = body.get("user", "shared") or "shared"

            if agent_id in self._config.skip_agent_ids:
                await self.app(scope, self._make_receiver(body), send)
                return

            messages = body.get("messages", [])
            enriched_messages, result = await self._service.enrich(messages)

            if result.has_context:
                body = {**body, "messages": enriched_messages}
                logger.debug(
                    "Enriched request: %d facts, %.1fms, %d tokens",
                    len(result.facts), result.latency_ms, result.token_estimate,
                )

            await self.app(scope, self._make_receiver(body), send)

        except Exception as e:
            logger.warning("Middleware error, passing through: %s", e)
            await self.app(scope, receive, send)

    def _should_intercept(self, scope) -> bool:
        if scope.get("type") != "http":
            return False
        if scope.get("method") != "POST":
            return False
        path = scope.get("path", "")
        return path == CHAT_COMPLETIONS_PATH or path.endswith(CHAT_COMPLETIONS_PATH)

    async def _read_body(self, receive) -> dict:
        chunks = []
        while True:
            event = await receive()
            if event["type"] == "http.request":
                chunks.append(event.get("body", b""))
                if not event.get("more_body", False):
                    break
        return json.loads(b"".join(chunks))

    def _make_receiver(self, body: dict):
        raw = json.dumps(body).encode()
        sent = False

        async def receiver():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": raw, "more_body": False}
            return {"type": "http.disconnect"}

        return receiver
```

---

## A.8 — Hook para Claude Code

Archivo: `~/.claude/hooks/memory_inject.py`

```python
#!/usr/bin/env python3
"""
UserPromptSubmit hook — inyecta contexto de memoria en cada turno de Claude Code.

Llama a Router-Jart /api/enrich. Si no está levantado → silencio total.
Timeout: 800ms (no bloquear la sesión).
"""
import json
import sys
import urllib.request
import urllib.error

ENRICH_URL = "http://localhost:10200/api/enrich"
TIMEOUT_S = 0.8
MIN_PROMPT_LEN = 20


def main() -> int:
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        return 0

    prompt = str(payload.get("prompt") or "")
    if len(prompt) < MIN_PROMPT_LEN:
        return 0

    try:
        body = json.dumps({
            "messages": [{"role": "user", "content": prompt}],
            "agent_id": "claude-code",
        }).encode()

        req = urllib.request.Request(
            ENRICH_URL,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            result = json.loads(r.read())

        injection = result.get("injection_text", "")
        if injection and result.get("was_enriched", False):
            print(json.dumps({"systemMessage": injection}))

    except (urllib.error.URLError, TimeoutError, OSError):
        pass  # Router-Jart no disponible → seguir sin memoria
    except Exception:
        pass  # cualquier error → silencio total

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

Cambio en `~/.claude/settings.json`:
```json
{
  "disableAllHooks": false,
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "python3 /Users/ruben/.claude/hooks/memory_inject.py"
          }
        ]
      }
    ]
  }
}
```

---

## Checklist de aceptación Fase A

- [ ] `pytest enrichment/tests/ -v` → todo verde
- [ ] `POST http://localhost:10200/api/enrich` con mensaje real → responde en < 300ms
- [ ] Si Backpack API está caído → respuesta en < 600ms, `was_enriched: false`
- [ ] Sesión real Claude Code → system prompt contiene `[JART-MEMORY:` en primer turno relevante
- [ ] No duplica el bloque si el turno siguiente también pasa por el hook
- [ ] `disableAllHooks: false` en settings.json y hook registrado
