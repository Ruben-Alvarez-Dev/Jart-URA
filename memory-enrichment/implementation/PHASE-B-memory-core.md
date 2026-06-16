# Fase B — jart-core-memory: Extracción como Servicio Autónomo

> **Objetivo**: `jart-core-memory` como HTTP service independiente en :8891  
> **Prerrequisitos**: Fase A en producción y validada  
> **Resultado**: Backpack API (:8890) deprecada, MCP limpio, router apuntando a :8891

---

## Estructura del nuevo servicio

```
~/Code/jart-core-memory/        ← NUEVO REPOSITORIO
├── pyproject.toml
├── README.md
├── Makefile
├── .env.example
├── src/
│   └── jart_core_memory/
│       ├── __init__.py
│       ├── main.py              ← FastAPI app + lifespan
│       ├── config.py            ← Settings desde env
│       ├── dependencies.py      ← FastAPI DI
│       ├── routers/
│       │   ├── __init__.py
│       │   ├── context.py       ← POST /api/context
│       │   ├── ingest.py        ← POST /api/ingest, /api/ingest/batch
│       │   ├── search.py        ← POST /api/search
│       │   ├── embed.py         ← POST /api/embed
│       │   └── ops.py           ← GET /api/health, /api/stats, POST /api/consolidate
│       ├── services/
│       │   ├── __init__.py
│       │   ├── context_service.py
│       │   ├── ingest_service.py
│       │   └── consolidation_service.py
│       ├── adapters/
│       │   ├── __init__.py
│       │   ├── qdrant_adapter.py
│       │   └── embedding_adapter.py
│       └── models/
│           ├── __init__.py
│           └── schemas.py       ← Pydantic v2 (de openapi-jart-core-memory.yaml)
├── tests/
│   ├── conftest.py
│   ├── test_context.py
│   ├── test_ingest.py
│   ├── test_search.py
│   └── test_ops.py
└── deploy/
    ├── com.jart-core-memory.plist   ← launchd service
    └── Dockerfile                   ← para integración con Jart-OS Docker
```

---

## B.1 — main.py

```python
"""jart-core-memory — servicio autónomo de infraestructura de memoria."""
from contextlib import asynccontextmanager
import logging
import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings
from .adapters.qdrant_adapter import QdrantAdapter
from .adapters.embedding_adapter import EmbeddingAdapter
from .routers import context, ingest, search, embed, ops

logger = logging.getLogger("jart.memory-core")

_START_TIME = time.monotonic()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = app.state.settings
    logger.info("jart-core-memory starting on :%d", settings.port)

    # Inicializar adaptadores y adjuntarlos al estado de la app
    qdrant = QdrantAdapter(url=settings.qdrant_url)
    embedding = EmbeddingAdapter(url=settings.embedding_url)

    # Verificar conectividad (no lanzar si no están disponibles — degraded mode)
    qdrant_ok = await qdrant.ping()
    embed_ok = await embedding.ping()
    logger.info("Qdrant: %s, Embedding: %s", "OK" if qdrant_ok else "DOWN", "OK" if embed_ok else "DOWN")

    app.state.qdrant = qdrant
    app.state.embedding = embedding
    app.state.start_time = _START_TIME

    yield

    logger.info("jart-core-memory shutdown")


def create_app(settings: Settings | None = None) -> FastAPI:
    if settings is None:
        settings = Settings()

    app = FastAPI(
        title="jart-core-memory",
        version="1.0.0",
        description="Servicio central de infraestructura de memoria para Jart-OS",
        docs_url="/docs",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    app.include_router(context.router, prefix="/api", tags=["context"])
    app.include_router(ingest.router, prefix="/api", tags=["ingest"])
    app.include_router(search.router, prefix="/api", tags=["search"])
    app.include_router(embed.router, prefix="/api", tags=["embed"])
    app.include_router(ops.router, prefix="/api", tags=["ops"])

    return app


if __name__ == "__main__":
    import uvicorn
    settings = Settings()
    uvicorn.run(create_app(settings), host="0.0.0.0", port=settings.port, log_level="info")
```

---

## B.2 — config.py

```python
from pydantic_settings import BaseSettings
from typing import list


class Settings(BaseSettings):
    port: int = 8891
    qdrant_url: str = "http://localhost:6333"
    embedding_url: str = "http://localhost:9000"
    default_token_budget: int = 2000
    default_min_score: float = 0.65
    embedding_cache_size: int = 1000
    consolidation_batch_size: int = 50
    cors_origins: list[str] = ["http://localhost:10200", "http://localhost:8890"]

    model_config = {"env_prefix": "JART_MEMORY_"}
```

---

## B.3 — routers/context.py

```python
"""POST /api/context — retrieval y formateo de injection_text."""
from fastapi import APIRouter, Request
import time

from ..models.schemas import ContextRequest, ContextResponse
from ..services.context_service import ContextService

router = APIRouter()


@router.post("/context", response_model=ContextResponse, status_code=200)
async def get_context(request: Request, body: ContextRequest) -> ContextResponse:
    service = ContextService(
        qdrant=request.app.state.qdrant,
        embedding=request.app.state.embedding,
        settings=request.app.state.settings,
    )
    return await service.retrieve(body)
```

---

## B.4 — services/context_service.py

```python
"""Lógica de retrieval: paralelo en 3 colecciones, rank, formato."""
import asyncio
import logging
import time
from datetime import datetime, timezone

from ..adapters.qdrant_adapter import QdrantAdapter
from ..adapters.embedding_adapter import EmbeddingAdapter
from ..config import Settings
from ..models.schemas import ContextRequest, ContextResponse, MemoryFact

logger = logging.getLogger("jart.memory-core.context")

INJECTION_HEADER = "[JART-MEMORY: contexto semánticamente relevante]"
INJECTION_FOOTER = "[/JART-MEMORY]"


class ContextService:
    COLLECTIONS = ["L0_L4_memory", "L3_facts", "L2_conversations"]

    def __init__(self, qdrant: QdrantAdapter, embedding: EmbeddingAdapter, settings: Settings):
        self._qdrant = qdrant
        self._embedding = embedding
        self._settings = settings

    async def retrieve(self, req: ContextRequest) -> ContextResponse:
        t0 = time.perf_counter()
        try:
            vector = await self._embedding.embed(req.query)
            if not vector:
                return ContextResponse.empty()

            collections = req.collections or self.COLLECTIONS
            min_score = req.min_score or self._settings.default_min_score

            # Búsqueda paralela en todas las colecciones
            tasks = [
                self._qdrant.search(
                    collection=col,
                    vector=vector,
                    limit=10,
                    score_threshold=min_score,
                )
                for col in collections
            ]
            results_per_col = await asyncio.gather(*tasks, return_exceptions=True)

            # Aplanar, deduplicar por memory_id, ordenar por score
            seen = set()
            facts = []
            for col_results in results_per_col:
                if isinstance(col_results, Exception):
                    continue
                for hit in col_results:
                    mid = hit.get("id", "")
                    if mid in seen:
                        continue
                    seen.add(mid)
                    payload = hit.get("payload", {})
                    facts.append(MemoryFact(
                        memory_id=mid,
                        content=payload.get("content", ""),
                        score=hit.get("score", 0.0),
                        layer=payload.get("layer", 0),
                        source=payload.get("collection", ""),
                        created_at=payload.get("created_at", ""),
                        metadata=payload.get("metadata", {}),
                    ))

            facts.sort(key=lambda f: f.score, reverse=True)

            # Truncar al token_budget
            budget = req.token_budget or self._settings.default_token_budget
            injection_text = self._format(facts, budget)

            latency_ms = (time.perf_counter() - t0) * 1000
            return ContextResponse(
                injection_text=injection_text,
                facts=facts,
                token_estimate=len(injection_text) // 4,
                retrieved_at=datetime.now(timezone.utc).isoformat(),
                latency_ms=latency_ms,
            )

        except Exception as e:
            logger.error("Context retrieval error: %s", e)
            return ContextResponse.empty()

    def _format(self, facts: list[MemoryFact], budget: int) -> str:
        if not facts:
            return ""

        lines = [INJECTION_HEADER]
        tokens_used = len(INJECTION_HEADER) // 4

        for f in facts:
            line = f"• [L{f.layer}/{f.score:.2f}] {f.content}"
            line_tokens = len(line) // 4
            if tokens_used + line_tokens > budget:
                break
            lines.append(line)
            tokens_used += line_tokens

        if len(lines) < 2:  # Solo el header, ningún fact cabió
            return ""

        lines.append(INJECTION_FOOTER)
        return "\n".join(lines)
```

---

## B.5 — adapters/qdrant_adapter.py (extracto clave)

```python
"""Adaptador Qdrant — migrado desde MCP-agent-memory/src/shared/qdrant_client.py."""
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import PointStruct, VectorParams, Distance
import uuid
import logging

logger = logging.getLogger("jart.memory-core.qdrant")


class QdrantAdapter:
    COLLECTIONS = {
        "L0_L4_memory": {"size": 1024, "distance": Distance.COSINE},
        "L2_conversations": {"size": 1024, "distance": Distance.COSINE},
        "L3_facts": {"size": 1024, "distance": Distance.COSINE},
    }

    def __init__(self, url: str = "http://localhost:6333"):
        self._client = AsyncQdrantClient(url=url, timeout=5.0)

    async def ping(self) -> bool:
        try:
            await self._client.get_collections()
            return True
        except Exception:
            return False

    async def search(
        self,
        collection: str,
        vector: list[float],
        limit: int = 10,
        score_threshold: float = 0.5,
        filters: dict | None = None,
    ) -> list[dict]:
        """Búsqueda vectorial. Devuelve lista de {id, score, payload}."""
        try:
            results = await self._client.search(
                collection_name=collection,
                query_vector=vector,
                limit=limit,
                score_threshold=score_threshold,
                with_payload=True,
            )
            return [
                {"id": str(r.id), "score": r.score, "payload": r.payload}
                for r in results
            ]
        except Exception as e:
            logger.debug("Qdrant search error in %s: %s", collection, e)
            return []

    async def upsert(self, collection: str, content: str, vector: list[float], payload: dict) -> str:
        """Almacena un punto. Devuelve el ID asignado."""
        point_id = str(uuid.uuid4())
        await self._client.upsert(
            collection_name=collection,
            points=[PointStruct(id=point_id, vector=vector, payload={**payload, "content": content})],
        )
        return point_id

    async def count(self, collection: str) -> int:
        try:
            result = await self._client.count(collection_name=collection, exact=False)
            return result.count
        except Exception:
            return 0
```

---

## B.6 — deploy/com.jart-core-memory.plist

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.jart-core-memory</string>

    <key>ProgramArguments</key>
    <array>
        <string>/Users/ruben/.venv/jart-core-memory/bin/python</string>
        <string>-m</string>
        <string>jart_core_memory.main</string>
    </array>

    <key>WorkingDirectory</key>
    <string>/Users/ruben/Code/jart-core-memory</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>JART_MEMORY_PORT</key>
        <string>8891</string>
        <key>JART_MEMORY_QDRANT_URL</key>
        <string>http://localhost:6333</string>
        <key>JART_MEMORY_EMBEDDING_URL</key>
        <string>http://localhost:9000</string>
    </dict>

    <key>StandardOutPath</key>
    <string>/tmp/jart-core-memory.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/jart-core-memory.error.log</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>
```

---

## B.7 — Cambios en cascada: MCP-agent-memory

### Archivo: `src/unified/server/main.py`

```python
# ELIMINAR (Fase B):
# from src.shared.api_server import start_api_server
# ...
# start_api_server(...)   ← eliminar la línea de arranque del sidecar

# MANTENER:
# Todas las tools MCP existentes
# Heartbeat, dream, consolidation background tasks
# El cliente Qdrant propio (hasta Fase C)
```

### Archivo: `src/L5_routing/server/main.py`

```python
# CAMBIO EN Fase C (no en B):
# request_context() se convierte en proxy a jart-core-memory
# En Fase B el MCP sigue usando su propio cliente Qdrant
```

### Deprecar `com.agent-memory.backpack-api.plist`

```bash
# Una vez Jart-Core-Memory está estable y Router-Jart apunta a :8891:
launchctl unload ~/Library/LaunchAgents/com.agent-memory.backpack-api.plist
# Mantener el archivo renombrado como .plist.deprecated durante 2 semanas
mv ~/Library/LaunchAgents/com.agent-memory.backpack-api.plist \
   ~/Library/LaunchAgents/com.agent-memory.backpack-api.plist.deprecated
```

---

## B.8 — Cambios en Router-Jart

### factory.py — cambio de URL al migrar de A a B

```python
# En Fase A:
# ENRICHMENT_MEMORY_URL=http://localhost:8890  (Backpack API)

# En Fase B — cambiar la variable de entorno:
# ENRICHMENT_MEMORY_URL=http://localhost:8891  (Jart-Core-Memory)

# NO es necesario cambiar código. Solo la variable de entorno.
# El BackpackMemoryAdapter sigue funcionando apuntando al nuevo puerto.
# En Fase B también se puede crear JartMemoryCoreAdapter con el cliente
# nuevo que usa /api/context en lugar de /api/request-context.
```

### adapters/memory/jart_core.py (Fase B — adaptador dedicado)

```python
"""Adaptador para Jart-Core-Memory (:8891) — Fase B."""
import asyncio, json, logging, time, urllib.request
from ..core.ports import IMemoryRetriever
from ..core.models import MemoryFact, MemoryResult, EnrichmentConfig

logger = logging.getLogger("jart.enrichment.jart_core")


class JartMemoryCoreAdapter(IMemoryRetriever):
    """Usa POST /api/context de Jart-Core-Memory — schema alineado con openapi-jart-core-memory.yaml."""

    def __init__(self, base_url: str = "http://localhost:8891", config: EnrichmentConfig | None = None):
        self._url = base_url.rstrip("/")
        self._config = config or EnrichmentConfig()

    async def query(self, query: str, agent_id: str = "shared",
                    token_budget: int = 2000, timeout_ms: int = 500) -> MemoryResult:
        t0 = time.perf_counter()
        try:
            payload = json.dumps({
                "query": query,
                "agent_id": agent_id,
                "token_budget": token_budget,
                "min_score": self._config.min_score,
            }).encode()
            req = urllib.request.Request(
                f"{self._url}/api/context",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            loop = asyncio.get_event_loop()
            raw = await asyncio.wait_for(
                loop.run_in_executor(None, lambda: self._do(req)),
                timeout=timeout_ms / 1000,
            )
            latency_ms = (time.perf_counter() - t0) * 1000
            return self._parse(raw, latency_ms)
        except asyncio.TimeoutError:
            return MemoryResult.empty()
        except Exception as e:
            logger.debug("jart-core-memory error: %s", e)
            return MemoryResult.empty()

    def _do(self, req):
        with urllib.request.urlopen(req, timeout=1.0) as r:
            return json.loads(r.read())

    def _parse(self, raw: dict, latency_ms: float) -> MemoryResult:
        facts = [
            MemoryFact(
                content=f.get("content", ""),
                score=f.get("score", 0.0),
                layer=f.get("layer", 0),
                source=f.get("source", ""),
                memory_id=f.get("memory_id", ""),
            )
            for f in raw.get("facts", [])
        ]
        return MemoryResult(
            facts=facts,
            injection_text=raw.get("injection_text", ""),
            token_estimate=raw.get("token_estimate", 0),
            latency_ms=latency_ms,
        )

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

## B.9 — Período de coexistencia dual (:8890 y :8891)

| Semana | :8890 (Backpack) | :8891 (Jart-Core-Memory) | Router apunta a |
|--------|-----------------|--------------------------|-----------------|
| B.0    | Running         | Deploy + tests           | :8890           |
| B.1    | Running         | Validado (query funciona)| :8891           |
| B.2    | Running (standby)| Producción              | :8891           |
| B.3    | Deprecated      | Producción              | :8891           |
| C.0    | plist removida  | Producción              | :8891           |

---

## Checklist de aceptación Fase B

- [ ] `pytest tests/ -v` en Jart-Core-Memory → todo verde
- [ ] `curl http://localhost:8891/api/health` → `{"status": "ok"}`
- [ ] `curl -X POST http://localhost:8891/api/context -d '{"query":"test"}'` → responde
- [ ] Router-Jart con `ENRICHMENT_MEMORY_URL=http://localhost:8891` → inyección funciona igual que con :8890
- [ ] MCP-agent-memory arranca sin iniciar Backpack API (sin hilo sidecar)
- [ ] `com.jart-core-memory.plist` cargado con `launchctl load`
- [ ] Logs en `/tmp/jart-core-memory.log` sin errores
- [ ] Backpack API (:8890) puede apagarse sin que el sistema de inyección se caiga
