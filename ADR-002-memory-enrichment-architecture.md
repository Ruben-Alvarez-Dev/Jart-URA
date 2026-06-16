# ADR-002 — Arquitectura de Inyección de Memoria para Jart-OS

> Estado: PROPUESTO  
> Fecha: 2026-06-08  
> Autor: Ramiro (🐺)  
> Reemplaza: intentos ad-hoc con hooks de Claude Code + Backpack API sin conectar

---

## Contexto

El sistema MCP-agent-memory existe y funciona. Almacena, embebe y consolida memoria en Qdrant (3 colecciones: `L0_L4_memory`, `L2_conversations`, `L3_facts`). Tiene un Backpack API en `:8890` con un endpoint `/api/request-context` que hace retrieval semántico sin implicar al LLM.

El problema: **la memoria nunca llega a los agentes de forma automática.**

Historial de intentos fallidos:
- Se asumió que el MCP inyectaría contexto por proximidad → incorrecto, MCP es pull-only
- Se añadió un hook `UserPromptSubmit` para Claude Code → `disableAllHooks: true`, nunca activo
- `cowork_bridge.sh` sincroniza archivos al inbox → es ingesta, no inyección
- `browseros-hook.sh` usa el Backpack API → solo cubre un cliente específico

**Causa raíz estructural**: la inyección se intentó en la capa de cliente (hooks por-aplicación). Es la capa incorrecta. Para que la inyección sea universal y mantenible, debe vivir en la capa de transporte — el proxy que todos los clientes comparten.

---

## Decisión

**Construir un `EnrichmentMiddleware` que viva en Jart-Router (:10200), no en los clientes.**

Toda petición que pase por Jart-Router pasa por el EnrichmentMiddleware antes de llegar al LLM. El middleware extrae la señal semántica del mensaje, consulta la memoria, e inyecta el contexto relevante en el system prompt. Transparente para todos los clientes.

Para clientes que no pasan por Jart-Router (Claude Code interactivo, Cowork), se provee un adaptador mínimo — un hook de una sola línea que llama al mismo servicio de enriquecimiento.

---

## Arquitectura

### Vista de alto nivel

```
┌────────────────────────────────────────────────────────────────────┐
│                           CLIENTES                                  │
│   Claude Code │ Cursor │ Windsurf │ Cowork │ VS Code │ REST/API   │
└──────┬────────┴───┬────┴────┬─────┴───┬────┴────┬────┴────────────┘
       │            │         │          │         │
       │  (hook     │         │          │         │
       │   mínimo)  │         │          │         │
       ▼            └─────────┴──────────┴─────────┘
  Hook adapter                      │
  (por cliente)               OpenAI API format
       │                            │
       └──────────────┬─────────────┘
                      ▼
          ┌───────────────────────┐
          │   JART-ROUTER :10200  │
          │                       │
          │  ┌─────────────────┐  │
          │  │  Auth Middleware │  │
          │  └────────┬────────┘  │
          │           ▼           │
          │  ┌─────────────────┐  │
          │  │  ENRICHMENT     │  │  ← pieza central de este ADR
          │  │  MIDDLEWARE     │  │
          │  └────────┬────────┘  │
          │           ▼           │
          │  ┌─────────────────┐  │
          │  │ Routing Engine  │  │
          │  └────────┬────────┘  │
          └───────────┼───────────┘
                      │
         ┌────────────┴────────────┐
         ▼                         ▼
  ┌─────────────┐         ┌────────────────┐
  │  LiteLLM    │         │   vLLM local   │
  │  :10201     │         │   :9000        │
  └─────────────┘         └────────────────┘
         │
    Cloud / Fallback
```

---

### Arquitectura Hexagonal del EnrichmentMiddleware

```
┌─────────────────────────────────────────────────────────────────┐
│                        DOMINIO (core)                            │
│                                                                   │
│  Puertos (interfaces):                                            │
│  ┌───────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │ IMemoryRetriever  │  │ IContextExtractor│  │ IFormatter    │ │
│  │                   │  │                  │  │               │ │
│  │ query(           │  │ extract(         │  │ format(       │ │
│  │   query: str,    │  │   messages: list │  │   result:     │ │
│  │   budget: int    │  │ ) -> str         │  │   MemResult,  │ │
│  │ ) -> MemResult   │  │                  │  │   style: str  │ │
│  └─────────┬─────────┘  └────────┬─────────┘  │ ) -> str     │ │
│            │                      │             └──────┬────────┘ │
│            └──────────────────────┼────────────────────┘          │
│                                   ▼                               │
│                    ┌──────────────────────────┐                  │
│                    │    EnrichmentService      │                  │
│                    │                           │                  │
│                    │  enrich(messages) →       │                  │
│                    │    messages (enriched)    │                  │
│                    │                           │                  │
│                    │  1. extractor.extract()   │                  │
│                    │  2. retriever.query()     │                  │
│                    │  3. formatter.format()    │                  │
│                    │  4. inject into messages  │                  │
│                    └──────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
         ▲                    ▲                    ▲
         │                    │                    │
┌────────┴──────┐  ┌──────────┴──────┐  ┌────────┴──────────────┐
│   ADAPTADORES │  │   ADAPTADORES   │  │   ADAPTADORES         │
│   de memoria  │  │   de extracción │  │   de inyección        │
│               │  │                 │  │                        │
│ QdrantAdapter │  │ MessageExtractor│  │ SystemPromptInjector  │
│ (direct)      │  │ (last N msgs +  │  │ (prepend to system)   │
│               │  │  entity scan)   │  │                        │
│ BackpackAdapter│  │                │  │ ToolResultInjector    │
│ (HTTP :8890)  │  │                 │  │ (as fake tool result)  │
│               │  │                 │  │                        │
│ NullAdapter   │  │                 │  │ NoopInjector          │
│ (test/bypass) │  │                 │  │ (passthrough/test)    │
└───────────────┘  └─────────────────┘  └───────────────────────┘
         ▲
         │ se conecta a
┌────────┴────────────────────────────────────────────────────────┐
│                   INFRAESTRUCTURA                                │
│                                                                   │
│   Qdrant :6333   │   Backpack API :8890   │   Config / Env      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Componentes

### 1. IMemoryRetriever (puerto)

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass

@dataclass
class MemoryFact:
    content: str
    score: float
    layer: int
    source: str

@dataclass
class MemoryResult:
    facts: list[MemoryFact]
    injection_text: str    # ya formateado para inyección
    token_estimate: int
    retrieved_at: float

class IMemoryRetriever(ABC):
    @abstractmethod
    async def query(
        self,
        query: str,
        agent_id: str = "shared",
        token_budget: int = 2000,
        timeout_ms: int = 500,
    ) -> MemoryResult: ...
```

### 2. IContextExtractor (puerto)

```python
class IContextExtractor(ABC):
    @abstractmethod
    def extract(self, messages: list[dict]) -> str:
        """
        Input:  lista de mensajes en formato OpenAI
                [{"role": "system", "content": "..."}, 
                 {"role": "user", "content": "..."}]
        Output: string semántico para usar como query en el retriever
        """
        ...
```

### 3. EnrichmentService (servicio de dominio)

```python
@dataclass
class EnrichmentConfig:
    enabled: bool = True
    token_budget: int = 2000        # máximo tokens de memoria a inyectar
    min_score: float = 0.65         # score mínimo para incluir un hecho
    timeout_ms: int = 500           # timeout duro para todo el retrieval
    injection_style: str = "block"  # block | inline | tool_result
    agent_id: str = "shared"
    skip_if_system_has_memory: bool = True  # no inyectar si ya hay [JART-MEMORY]

class EnrichmentService:
    def __init__(
        self,
        retriever: IMemoryRetriever,
        extractor: IContextExtractor,
        config: EnrichmentConfig,
    ): ...

    async def enrich(self, messages: list[dict]) -> list[dict]:
        """
        Contrato:
        - Si la memoria no responde en timeout_ms → devuelve messages sin modificar
        - Si no hay hechos relevantes → devuelve messages sin modificar
        - Si ya hay [JART-MEMORY] en el system prompt → no duplicar
        - Siempre devuelve una lista válida de mensajes
        """
        ...
```

### 4. Adaptadores de memoria

**QdrantMemoryAdapter** — acceso directo, máximo control:
```python
class QdrantMemoryAdapter(IMemoryRetriever):
    """
    Consulta L0_L4_memory, L2_conversations, L3_facts en paralelo.
    Fusiona resultados por score, deduplica, trunca a token_budget.
    """
    def __init__(self, qdrant_url: str, embedding_url: str, config: EnrichmentConfig): ...
    
    async def query(self, query: str, ...) -> MemoryResult:
        vector = await self._embed(query)                     # embedding local
        results = await asyncio.gather(
            self._search("L0_L4_memory", vector, limit=5),
            self._search("L3_facts", vector, limit=3),
            self._search("L2_conversations", vector, limit=2),
            return_exceptions=True
        )
        return self._merge_and_rank(results)
```

**BackpackMemoryAdapter** — usa el HTTP API existente (zero-cambios al servidor MCP):
```python
class BackpackMemoryAdapter(IMemoryRetriever):
    """
    Delega a http://127.0.0.1:8890/api/request-context.
    Útil cuando el servidor MCP ya está corriendo y no queremos duplicar embedding.
    """
    def __init__(self, backpack_url: str = "http://127.0.0.1:8890"): ...
    
    async def query(self, query: str, ...) -> MemoryResult:
        async with httpx.AsyncClient(timeout=timeout_ms/1000) as client:
            r = await client.post(f"{self.backpack_url}/api/request-context",
                                  json={"query": query, "agent_id": agent_id})
        return self._parse(r.json())
```

### 5. MessageContextExtractor (adaptador de extracción)

```python
class MessageContextExtractor(IContextExtractor):
    """
    Estrategia por capas (en orden de prioridad):
    1. Último mensaje del usuario (siempre presente)
    2. Keywords del system prompt (si contiene entidades técnicas nombradas)
    3. Resumen de las últimas N interacciones (sliding window)
    
    El resultado es un string de max 512 tokens para el embedding.
    """
    def __init__(self, window: int = 3, max_tokens: int = 512): ...
    
    def extract(self, messages: list[dict]) -> str:
        last_user = self._last_user_message(messages)
        system_entities = self._extract_entities(messages, role="system")
        recent_context = self._sliding_window(messages, self.window)
        return self._compose(last_user, system_entities, recent_context, self.max_tokens)
```

### 6. SystemPromptInjector (adaptador de inyección)

```python
class SystemPromptInjector:
    """
    Inyección como bloque al final del system prompt existente.
    Formato canónico:
    
        [JART-MEMORY: contexto semánticamente relevante]
        • [L3/0.91] Jart-Router está en :10200, LiteLLM en :10201
        • [L4/0.87] El agente "director" usa qwen25-director como alias
        • [L2/0.78] Última decisión sobre vLLM: postponer hasta benchmark GPU
        [/JART-MEMORY]
    
    Idempotente: no inyecta si ya existe el bloque.
    """
    MARKER_START = "[JART-MEMORY:"
    MARKER_END = "[/JART-MEMORY]"
    
    def inject(self, messages: list[dict], memory_result: MemoryResult) -> list[dict]:
        if not memory_result.facts:
            return messages
        if self._already_injected(messages):
            return messages
        return self._prepend_to_system(messages, self._format(memory_result))
    
    def _format(self, result: MemoryResult) -> str:
        lines = [f"{self.MARKER_START} contexto semánticamente relevante]"]
        for f in result.facts:
            lines.append(f"• [L{f.layer}/{f.score:.2f}] {f.content}")
        lines.append(self.MARKER_END)
        return "\n".join(lines)
```

### 7. EnrichmentMiddleware (interfaz HTTP, para Jart-Router)

```python
class EnrichmentMiddleware:
    """
    FastAPI middleware. Intercepta POST /v1/chat/completions,
    enriquece los messages, reenvía al backend.
    
    Criterios de skip (no enriquecer):
    - Petición sin messages
    - Petición de embedding (/v1/embeddings)
    - config.enabled = False
    - Agent-ID en lista de exclusión
    - Memory system timeout > threshold acumulado
    """
    def __init__(self, app, enrichment_service: EnrichmentService, config: EnrichmentConfig):
        ...
    
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not self._should_enrich(scope):
            await self.app(scope, receive, send)
            return
        
        body = await self._read_body(receive)
        enriched_body = await self._enrich(body)
        await self.app(scope, self._replay(enriched_body), send)
```

---

## Estructura de directorios

```
Jart-OS/
└── TIERS/
    └── TIER-02-GATEWAY/
        ├── 10200-router-jart/
        │   ├── src/
        │   │   ├── main.py
        │   │   ├── router.py
        │   │   ├── health.py
        │   │   └── enrichment/               ← NUEVO (este ADR)
        │   │       ├── __init__.py
        │   │       ├── core/
        │   │       │   ├── ports.py          # IMemoryRetriever, IContextExtractor
        │   │       │   ├── models.py         # MemoryFact, MemoryResult, EnrichmentConfig
        │   │       │   └── service.py        # EnrichmentService
        │   │       ├── adapters/
        │   │       │   ├── memory/
        │   │       │   │   ├── qdrant.py     # QdrantMemoryAdapter
        │   │       │   │   ├── backpack.py   # BackpackMemoryAdapter
        │   │       │   │   └── null.py       # NullMemoryAdapter (tests)
        │   │       │   ├── extraction/
        │   │       │   │   └── message.py    # MessageContextExtractor
        │   │       │   └── injection/
        │   │       │       ├── system_prompt.py  # SystemPromptInjector
        │   │       │       └── noop.py           # NoopInjector (tests)
        │   │       ├── middleware.py          # EnrichmentMiddleware (FastAPI)
        │   │       ├── factory.py            # build_enrichment_service() desde env
        │   │       └── tests/
        │   │           ├── test_service.py
        │   │           ├── test_adapters.py
        │   │           └── conftest.py
        │   └── docker-compose.yml
        │
        ├── 10201-proxy-litellm/              ← existente
        └── 10202-inference-vllm/             ← futuro
```

---

## Adaptadores por cliente (los que no usan Jart-Router)

Para Claude Code y otros clientes interactivos que NO pasan por el proxy HTTP, se provee un hook mínimo que llama al mismo servicio. La diferencia: en lugar de middleware HTTP, es un script que llama a un endpoint expuesto por Jart-Router.

### Endpoint de enriquecimiento aislado (nuevo en Jart-Router)

```
POST http://localhost:10200/api/enrich
Content-Type: application/json

{"messages": [...], "agent_id": "claude-code"}

→ {"injection_text": "...", "facts_count": 3}
```

### Hook para Claude Code (mínimo, reutiliza el endpoint)

```python
# ~/.claude/hooks/memory_inject.py
#!/usr/bin/env python3
"""
UserPromptSubmit hook — inyecta contexto de memoria antes de cada turno.
Llama a Jart-Router /api/enrich. Si Jart-Router no está → silencio total.
"""
import json, sys, urllib.request

def main():
    payload = json.loads(sys.stdin.read() or "{}")
    prompt = str(payload.get("prompt") or "")
    if len(prompt) < 20:
        return 0
    try:
        req = urllib.request.Request(
            "http://localhost:10200/api/enrich",
            data=json.dumps({
                "messages": [{"role": "user", "content": prompt}],
                "agent_id": "claude-code",
            }).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=0.8) as r:
            result = json.loads(r.read())
        injection = result.get("injection_text", "")
        if injection:
            print(json.dumps({"systemMessage": injection}))
    except Exception:
        pass  # memoria no disponible → seguir sin ella
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

El hook es idéntico para Cursor, Windsurf, cualquier IDE que soporte hooks. Un solo endpoint, múltiples consumidores.

---

## Principios SOLID aplicados

| Principio | Aplicación |
|-----------|-----------|
| **S** — Single Responsibility | `EnrichmentService` solo orquesta. `QdrantAdapter` solo recupera. `SystemPromptInjector` solo formatea e inyecta. |
| **O** — Open/Closed | Para añadir un nuevo backend de memoria (Engram, Neo4j, etc.) → implementar `IMemoryRetriever`, zero cambios al servicio. |
| **L** — Liskov Substitution | `BackpackMemoryAdapter` y `QdrantMemoryAdapter` son intercambiables — mismo contrato, mismos errores. |
| **I** — Interface Segregation | `IMemoryRetriever`, `IContextExtractor` son puertos pequeños y enfocados. Ningún adaptador implementa más de uno. |
| **D** — Dependency Inversion | `EnrichmentService` depende de abstracciones (`IMemoryRetriever`), no de `httpx` ni `qdrant-client` directamente. |

---

## Gestión de errores y degradación

```
EnrichmentService.enrich() NUNCA lanza excepción al llamador.

Casos y comportamiento:
┌──────────────────────────────────────┬─────────────────────────────────┐
│ Caso                                 │ Resultado                       │
├──────────────────────────────────────┼─────────────────────────────────┤
│ Qdrant no disponible                 │ devuelve messages sin modificar │
│ Embedding server no disponible       │ devuelve messages sin modificar │
│ Timeout > 500ms                      │ cancela, devuelve original      │
│ No facts con score > min_score       │ devuelve messages sin modificar │
│ System prompt ya tiene [JART-MEMORY] │ devuelve messages sin modificar │
│ messages vacío o None                │ devuelve messages sin modificar │
│ token_budget agotado                 │ incluye solo facts que caben    │
└──────────────────────────────────────┴─────────────────────────────────┘
```

---

## Qué se mantiene, qué se retira, qué se ajusta

| Componente | Decisión | Motivo |
|------------|----------|--------|
| `backpack_api.py` (:8890) | **Mantener** | BackpackMemoryAdapter lo usa; también útil para ingesta directa |
| `cowork_bridge.sh` | **Mantener** | Sirve para INGESTA (Cowork → inbox). No es inyección. |
| `browseros-hook.sh` | **Deprecar** | Sustituido por el endpoint `/api/enrich` de Jart-Router |
| Hooks Claude Code actuales | **Activar + simplificar** | `disableAllHooks: true` → `false`. Solo añadir `memory_inject.py` |
| `L5_routing.request_context` | **Mantener** | Es el núcleo del retrieval. BackpackMemoryAdapter lo invoca via HTTP. |
| `push_reminder` / `check_reminders` | **Mantener** | Útiles para recordatorios inter-turno gestionados por el LLM |

---

## Decisiones de diseño y sus alternativas descartadas

**¿Por qué el middleware vive en Jart-Router y no en LiteLLM?**

LiteLLM tiene hooks de pre-procesamiento, pero son menos controlables y más difíciles de testear independientemente. Jart-Router es código propio → control total, tests unitarios directos, logging propio.

**¿Por qué no usar MCP Resources para inyección?**

MCP Resources son "listas de archivos" que el host puede incluir, pero no hay API estándar para recursos dinámicos que se actualicen por turno. El soporte varía por cliente. La solución de proxy es 100% agnóstica y no depende de que el cliente implemente el Resource protocol correctamente.

**¿Por qué no hacer el retrieval directamente en el hook (sin Jart-Router)?**

Porque entonces cada cliente necesita acceso a Qdrant, al servidor de embedding, y mantener el código de retrieval. Si la lógica cambia, hay que actualizar N hooks. Con el endpoint centralizado, cambias uno y todos se benefician.

**¿Por qué BackpackMemoryAdapter si podemos ir directo a Qdrant?**

`BackpackMemoryAdapter` es el adaptador por defecto en despliegues donde el servidor MCP ya está corriendo (launchd). Cero duplicación de embedding. `QdrantMemoryAdapter` es para cuando Jart-Router vive en Docker separado y el Backpack API no es accesible.

---

## Plan de implementación

### Fase 1 — Core + BackpackAdapter (1 día)
- [ ] Definir `ports.py`, `models.py`
- [ ] Implementar `EnrichmentService`
- [ ] Implementar `BackpackMemoryAdapter`
- [ ] Implementar `MessageContextExtractor`
- [ ] Implementar `SystemPromptInjector`
- [ ] Tests unitarios con `NullMemoryAdapter`

### Fase 2 — Integración Jart-Router (1 día)
- [ ] Añadir `EnrichmentMiddleware` a Jart-Router
- [ ] Exponer `POST /api/enrich` endpoint independiente
- [ ] `factory.py` que construye el servicio desde env vars
- [ ] Tests de integración con Backpack API real

### Fase 3 — Activar clientes (horas)
- [ ] Escribir `memory_inject.py` hook
- [ ] `disableAllHooks: false` en `~/.claude/settings.json`
- [ ] Añadir hook a `UserPromptSubmit`
- [ ] Verificar inyección en Claude Code con sesión real

### Fase 4 — QdrantAdapter directo (opcional, para Docker isolation)
- [ ] `QdrantMemoryAdapter` con búsqueda paralela en 3 colecciones
- [ ] Configurar via env: `MEMORY_BACKEND=qdrant|backpack`

---

## Métricas de éxito

- Latencia añadida por inyección: < 200ms en p95
- Tasa de inyección con contexto relevante: > 60% de turnos en sesiones de proyecto
- Tasa de degradación silenciosa (memoria caída, request normal): 100%
- Score mínimo de facts inyectados: > 0.65
- Clientes beneficiados sin cambios de cliente: todos los que pasan por Jart-Router
