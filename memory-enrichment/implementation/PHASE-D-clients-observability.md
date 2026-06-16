# Fase D — Clientes + Observabilidad

> **Objetivo**: Activar hooks en todos los IDEs, añadir métricas Prometheus, dashboard Grafana  
> **Prerrequisitos**: Fase C completa  
> **Resultado**: Sistema completo con cobertura de clientes e instrumentación productiva

---

## D.1 — Hooks por cliente

### D.1.1 — Claude Code

Activar `memory_inject.py` (creado en Fase A):

```json
// ~/.claude/settings.json
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

El hook `memory_inject.py` ya está definido en PHASE-A-quickwin.md. No requiere modificación en Fase D.

---

### D.1.2 — Cursor

Archivo: `~/.cursor/hooks/memory_inject.py` (misma lógica que Claude Code)

```python
#!/usr/bin/env python3
"""Hook UserPromptSubmit para Cursor — inyección de contexto de memoria."""
import json, sys, urllib.request, urllib.error

ENRICH_URL = "http://localhost:10200/api/enrich"
TIMEOUT_S = 0.8

def main() -> int:
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        return 0

    prompt = str(payload.get("prompt") or payload.get("userInput") or "")
    if len(prompt) < 20:
        return 0

    try:
        body = json.dumps({
            "messages": [{"role": "user", "content": prompt}],
            "agent_id": "cursor",
        }).encode()
        req = urllib.request.Request(ENRICH_URL, data=body,
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            result = json.loads(r.read())
        injection = result.get("injection_text", "")
        if injection and result.get("was_enriched", False):
            print(json.dumps({"systemMessage": injection}))
    except Exception:
        pass
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

Configuración en `~/.cursor/settings.json` o mediante la UI de Cursor en Settings > Hooks.

---

### D.1.3 — Windsurf

Archivo: `~/.codeium/windsurf/hooks/memory_inject.py`

Misma lógica, con `agent_id: "windsurf"`. Registrar en la configuración de hooks de Windsurf.

---

### D.1.4 — Cowork (Anthropic Desktop)

Cowork pasa por Router-Jart automáticamente vía middleware — no necesita hook adicional. El enrichment ya actúa en cada petición al proxy.

---

### D.1.5 — VS Code Insiders

Archivo: `~/Library/Application Support/Code - Insiders/User/hooks/memory_inject.py`

Misma lógica, con `agent_id: "vscode-insiders"`.

---

## D.2 — Endpoint `/api/enrich` en Router-Jart

Añadir router explícito en `10200-router-jart/src/main.py`:

```python
# src/main.py
from .enrichment.routers import enrich_router

app.include_router(enrich_router, prefix="/api")
```

```python
# src/enrichment/routers.py
from fastapi import APIRouter, Request
from .core.models import EnrichmentConfig
from .factory import build_enrichment_service
from .core.models import MemoryResult

router = APIRouter()
_service = None


def get_service():
    global _service
    if _service is None:
        _service = build_enrichment_service()
    return _service


@router.post("/enrich")
async def enrich(request: Request, body: dict):
    """Endpoint explícito para hooks de cliente."""
    messages = body.get("messages", [])
    agent_id = body.get("agent_id", "shared")

    service = get_service()
    enriched, result = await service.enrich(messages)

    return {
        "messages": enriched,
        "injection_text": result.injection_text,
        "facts_count": len(result.facts),
        "was_enriched": result.has_context,
        "latency_ms": result.latency_ms,
        "degraded": not result.has_context and result.latency_ms > 490,
    }


@router.get("/enrich/health")
async def enrich_health(request: Request):
    service = get_service()
    retriever = service._retriever
    mem_ok = await retriever.health()
    return {
        "middleware_status": "active",
        "memory_service": "reachable" if mem_ok else "unreachable",
        "memory_service_url": service._config.memory_url,
    }


@router.get("/enrich/config")
async def enrich_config(request: Request):
    service = get_service()
    cfg = service._config
    return {
        "enabled": cfg.enabled,
        "memory_url": cfg.memory_url,
        "token_budget": cfg.token_budget,
        "min_score": cfg.min_score,
        "timeout_ms": cfg.timeout_ms,
        "cache_ttl_s": cfg.cache_ttl_s,
        "skip_agent_ids": cfg.skip_agent_ids,
    }
```

---

## D.3 — Métricas Prometheus

### D.3.1 — En Router-Jart

```python
# src/enrichment/metrics.py
from prometheus_client import Counter, Histogram, Gauge

enrichment_requests_total = Counter(
    "jart_enrichment_requests_total",
    "Total de peticiones procesadas por el EnrichmentMiddleware",
    ["enriched", "agent_id"],
)
enrichment_latency_ms = Histogram(
    "jart_enrichment_latency_ms",
    "Latencia del proceso de enriquecimiento en ms",
    buckets=[10, 50, 100, 200, 300, 500, 1000],
)
enrichment_facts_injected = Histogram(
    "jart_enrichment_facts_injected",
    "Número de facts inyectados por petición",
    buckets=[0, 1, 2, 3, 5, 10],
)
memory_service_availability = Gauge(
    "jart_memory_service_available",
    "1 si Jart-Core-Memory está accesible, 0 si no",
)
```

### D.3.2 — En Jart-Core-Memory

```python
# src/jart_core_memory/metrics.py
from prometheus_client import Counter, Histogram, Gauge

context_requests_total = Counter(
    "jart_core_context_requests_total",
    "Total de peticiones a /api/context",
    ["status"],  # ok, error, empty
)
ingest_total = Counter(
    "jart_core_ingest_total",
    "Total de memorias ingestadas",
    ["event_type", "collection"],
)
qdrant_latency_ms = Histogram(
    "jart_core_qdrant_latency_ms",
    "Latencia de búsqueda en Qdrant",
    buckets=[5, 10, 25, 50, 100, 250, 500],
)
embedding_latency_ms = Histogram(
    "jart_core_embedding_latency_ms",
    "Latencia del modelo de embedding",
    buckets=[10, 25, 50, 100, 200, 500],
)
collection_sizes = Gauge(
    "jart_core_collection_size",
    "Número de documentos por colección Qdrant",
    ["collection"],
)
```

---

## D.4 — Dashboard Grafana

Paneles mínimos (JSON exportable):

```yaml
Paneles recomendados:
  1. Enrichment rate (% peticiones enriquecidas sobre total últimas 1h)
  2. Enrichment latency P50/P95/P99 (ms)
  3. Facts injected per request (promedio)
  4. Memory service availability (1/0 gauge)
  5. Context request rate (req/min a Jart-Core-Memory)
  6. Qdrant latency P95 por colección
  7. Embedding latency P95
  8. Collection sizes (L0_L4_memory, L3_facts, L2_conversations)
  9. Ingest rate por event_type

Alertas mínimas:
  - enrichment_latency_ms P95 > 400ms durante 5 min → warning
  - jart_memory_service_available == 0 durante 1 min → critical
  - collection_sizes{L0_L4_memory} > 50000 → info (revisar consolidación)
```

---

## D.5 — Jart-OS: Docker Compose

Archivo: `docker-compose.yml` o `docker-compose.memory.yml` en el repo Jart-OS:

```yaml
services:
  jart-core-memory:
    build:
      context: /Users/ruben/Code/jart-core-memory
      dockerfile: deploy/Dockerfile
    ports:
      - "8891:8891"
    environment:
      JART_MEMORY_PORT: "8891"
      JART_MEMORY_QDRANT_URL: "http://qdrant:6333"
      JART_MEMORY_EMBEDDING_URL: "http://embedding:9000"
    depends_on:
      - qdrant
      - embedding
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8891/api/health"]
      interval: 10s
      timeout: 3s
      retries: 3

  # Deprecar backpack-api si existía como servicio propio:
  # backpack-api:  ← ELIMINAR en Fase D
```

---

## D.6 — Verificación final del stack completo

```bash
#!/bin/bash
# scripts/verify-enrichment-stack.sh

echo "=== Jart-Core-Memory (:8891) ==="
curl -s http://localhost:8891/api/health | python3 -m json.tool

echo ""
echo "=== Router-Jart Enrichment (:10200) ==="
curl -s http://localhost:10200/api/enrich/health | python3 -m json.tool

echo ""
echo "=== Test de inyección completo ==="
curl -s -X POST http://localhost:10200/api/enrich \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "estado del sistema Jart"}], "agent_id": "test"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('Enriched:', d['was_enriched'], '| Facts:', d['facts_count'], '| Latency:', d['latency_ms'], 'ms')"

echo ""
echo "=== Backpack API (:8890) — debe estar DOWN ==="
curl -s --max-time 2 http://localhost:8890/api/health && echo "ADVERTENCIA: aún activo" || echo "OK: no responde"
```

---

## Checklist de aceptación Fase D

- [ ] Hook `memory_inject.py` activo en Claude Code — `disableAllHooks: false`
- [ ] Hooks equivalentes en Cursor y Windsurf
- [ ] `POST /api/enrich` responde en Router-Jart
- [ ] Métricas Prometheus accesibles en `http://localhost:10200/metrics`
- [ ] Dashboard Grafana importado y datos fluyendo
- [ ] `verify-enrichment-stack.sh` pasa sin errores
- [ ] Backpack API (:8890) sin responder
- [ ] Jart-Core-Memory en docker-compose para entorno Docker de Jart-OS
