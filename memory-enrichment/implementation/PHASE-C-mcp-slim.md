# Fase C — MCP Slim: MCP-agent-memory como Capa Delgada

> **Objetivo**: MCP-agent-memory delega infraestructura a Jart-Core-Memory, retiene solo tools MCP  
> **Prerrequisitos**: Fase B completa — Jart-Core-Memory estable en :8891  
> **Resultado**: MCP ligero, sin lógica de infraestructura duplicada

---

## Qué se retiene en MCP-agent-memory

| Responsabilidad | Antes de Fase C | Después de Fase C |
|----------------|----------------|------------------|
| Tools MCP (memoria, contexto, etc.) | ✅ MCP | ✅ MCP (sin cambios de interfaz) |
| Backpack API HTTP sidecar (:8890) | ✅ MCP | ❌ Eliminado (ya deprecado en Fase B) |
| Cliente Qdrant directo | ✅ MCP (propio) | ❌ Delegado a Jart-Core-Memory |
| Pipeline de embeddings | ✅ MCP (propio) | ❌ Delegado a Jart-Core-Memory |
| L5_routing.request_context() | ✅ MCP | ⚡ Proxy a `/api/context` |
| L0–L4 consolidation tasks | ✅ MCP | ⚡ Trigger a `/api/consolidate` |
| Ingesta de eventos | ✅ MCP | ⚡ Proxy a `/api/ingest` |
| Background jobs (dream, lifecycle) | ✅ MCP | ✅ MCP — solo estos permanecen |

---

## C.1 — Cliente HTTP interno del MCP

Crear `src/shared/core_memory_client.py` en MCP-agent-memory:

```python
"""
Cliente HTTP hacia Jart-Core-Memory (:8891).
Reemplaza el cliente Qdrant directo en las tools MCP.
"""
from __future__ import annotations
import json
import logging
import urllib.request
import urllib.error
from typing import Optional

logger = logging.getLogger("mcp.core_memory_client")

CORE_MEMORY_URL = "http://localhost:8891"


class CoreMemoryClient:
    """Wrapper síncrono sobre Jart-Core-Memory para uso desde tools MCP."""

    def __init__(self, base_url: str = CORE_MEMORY_URL):
        self._base = base_url.rstrip("/")

    def request_context(self, query: str, agent_id: str = "shared",
                        token_budget: int = 2000) -> dict:
        """Llama a POST /api/context. Devuelve {injection_text, facts}."""
        return self._post("/api/context", {
            "query": query,
            "agent_id": agent_id,
            "token_budget": token_budget,
        })

    def ingest(self, content: str, event_type: str, source: str = "mcp",
               actor_id: str = "shared", session_id: str = "",
               metadata: dict | None = None) -> dict:
        """Llama a POST /api/ingest."""
        return self._post("/api/ingest", {
            "content": content,
            "event_type": event_type,
            "source": source,
            "actor_id": actor_id,
            "session_id": session_id,
            "metadata": metadata or {},
        })

    def search(self, query: str, collection: str = "L0_L4_memory",
               limit: int = 10) -> dict:
        """Llama a POST /api/search."""
        return self._post("/api/search", {
            "query": query,
            "collection": collection,
            "limit": limit,
        })

    def consolidate(self, dry_run: bool = False) -> dict:
        return self._post("/api/consolidate", {"dry_run": dry_run})

    def health(self) -> dict:
        return self._get("/api/health")

    def stats(self) -> dict:
        return self._get("/api/stats")

    # ── internos ─────────────────────────────────────────────────────────────

    def _post(self, path: str, body: dict, timeout: float = 3.0) -> dict:
        try:
            data = json.dumps(body).encode()
            req = urllib.request.Request(
                f"{self._base}{path}",
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except Exception as e:
            logger.warning("CoreMemoryClient POST %s failed: %s", path, e)
            return {}

    def _get(self, path: str, timeout: float = 2.0) -> dict:
        try:
            req = urllib.request.Request(f"{self._base}{path}")
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except Exception as e:
            logger.warning("CoreMemoryClient GET %s failed: %s", path, e)
            return {}
```

---

## C.2 — Refactor de tools MCP

### Antes (ejemplo simplificado de una tool de búsqueda):

```python
# src/L3_semantic/tools/search_memory.py
async def search_memory_tool(query: str, agent_id: str) -> str:
    qdrant = get_qdrant_client()
    embedding_model = get_embedding_model()
    vector = embedding_model.embed(query)
    results = qdrant.search("L0_L4_memory", vector, limit=10)
    return format_results(results)
```

### Después (Fase C):

```python
# src/L3_semantic/tools/search_memory.py
from src.shared.core_memory_client import CoreMemoryClient

_client = CoreMemoryClient()

async def search_memory_tool(query: str, agent_id: str) -> str:
    result = _client.search(query=query, collection="L0_L4_memory", limit=10)
    facts = result.get("results", [])
    return format_results(facts)
```

---

## C.3 — Refactor de L5_routing.request_context()

```python
# src/L5_routing/server/main.py — ANTES

async def request_context(query: str, agent_id: str = "shared",
                          intent: str = "answer", token_budget: int = 2000) -> ContextPackResult:
    # Lógica de retrieval directo contra Qdrant aquí...
    vector = embedding_model.embed(query)
    results_l0l4 = qdrant.search("L0_L4_memory", vector, ...)
    results_l3 = qdrant.search("L3_facts", vector, ...)
    # ...combinar, rankear, formatear...
    return ContextPackResult(injection_text=..., ...)
```

```python
# src/L5_routing/server/main.py — DESPUÉS (Fase C)

from src.shared.core_memory_client import CoreMemoryClient

_client = CoreMemoryClient()

async def request_context(query: str, agent_id: str = "shared",
                          intent: str = "answer", token_budget: int = 2000) -> ContextPackResult:
    raw = _client.request_context(query=query, agent_id=agent_id, token_budget=token_budget)
    injection_text = raw.get("injection_text", "")
    return ContextPackResult(
        injection_text=injection_text,
        sources=raw.get("facts", []),
        token_estimate=raw.get("token_estimate", 0),
    )
```

---

## C.4 — Eliminación del Backpack API sidecar

```python
# src/unified/server/main.py — ELIMINAR estas líneas:

# from src.shared.api_server import start_api_server
# ...
# api_thread = threading.Thread(target=start_api_server, args=(request_context_fn,), daemon=True)
# api_thread.start()
# logger.info("Backpack API sidecar started on :8890")
```

El archivo `src/shared/api_server.py` puede mantenerse como legacy o eliminarse.

---

## C.5 — Cambios en launchd

```bash
# Eliminar plist del Backpack API (ya en .deprecated desde Fase B):
rm ~/Library/LaunchAgents/com.agent-memory.backpack-api.plist.deprecated

# El MCP sigue arrancando con su propio plist:
# ~/Library/LaunchAgents/com.agent-memory.plist  → sin cambios
```

---

## C.6 — Cambios en cliente IDE — configs mcp.json

Las configs MCP NO necesitan cambios en Fase C — el MCP conserva exactamente los mismos nombres de herramientas. Solo cambia la implementación interna.

**Claude Code** (`~/.claude/settings.json`):
```json
// Sin cambios en Fase C
```

**Cursor** (`~/.cursor/mcp.json`):
```json
// Sin cambios en Fase C
```

**Windsurf** (`~/.codeium/windsurf/mcp.json`):
```json
// Sin cambios en Fase C
```

---

## C.7 — cowork_bridge.sh

```bash
# Actualizar: las llamadas al Backpack API (:8890) → Jart-Core-Memory (:8891)

# ANTES:
curl -s -X POST http://localhost:8890/api/ingest-event \
  -H "Content-Type: application/json" \
  -d "{\"content\": \"$content\", \"event_type\": \"observation\"}"

# DESPUÉS:
curl -s -X POST http://localhost:8891/api/ingest \
  -H "Content-Type: application/json" \
  -d "{\"content\": \"$content\", \"event_type\": \"observation\", \"source\": \"cowork-bridge\"}"
```

---

## Checklist de aceptación Fase C

- [ ] MCP-agent-memory arranca sin iniciar ningún HTTP sidecar
- [ ] Tools MCP (search_memory, save_memory, etc.) funcionan via CoreMemoryClient
- [ ] `request_context` MCP devuelve el mismo resultado que `POST /api/context` directamente
- [ ] Router-Jart sigue funcionando con :8891 (sin involucrar al MCP para retrieval)
- [ ] cowork_bridge.sh ingestando a :8891 correctamente
- [ ] Backpack API (:8890) completamente deprecada — no se inicia en ningún proceso
- [ ] Claude Code, Cursor, Windsurf funcionan con las tools MCP (sin cambios visibles)
