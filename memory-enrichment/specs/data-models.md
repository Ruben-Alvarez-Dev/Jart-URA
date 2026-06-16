# Data Models — jart-memory-enrichment

> Fuente de verdad para todos los modelos de datos del sistema.  
> Referencia: `openapi-jart-core-memory.yaml`, `openapi-enrichment-endpoint.yaml`

---

## 1. MemoryFact

Unidad atómica de información recuperada de Qdrant.

```json
{
  "memory_id": "550e8400-e29b-41d4-a716-446655440000",
  "content": "Router-Jart escucha en el puerto 10200",
  "score": 0.91,
  "layer": 3,
  "source": "L3_facts",
  "created_at": "2026-06-01T14:23:00Z",
  "metadata": {
    "project": "jart-os",
    "scope": "infrastructure",
    "change_speed": "slow",
    "actor_id": "director",
    "session_id": "abc123"
  }
}
```

**Capas de memoria (layer)**:

| Layer | Nombre | TTL sugerido | Descripción |
|-------|--------|-------------|-------------|
| 0 | Sensory | Horas | Eventos crudos recientes |
| 1 | Working | Días | Contexto de trabajo activo |
| 2 | Episodic | Semanas | Resúmenes de conversaciones |
| 3 | Semantic | Meses | Hechos durables y decisiones |
| 4 | Narrative | Años | Patrones y aprendizajes de alto nivel |
| 5 | Selective | Permanente | Hechos críticos curados manualmente |

**change_speed** — cómo de rápido puede cambiar este hecho:

| Valor | Ejemplo | Verificación |
|-------|---------|-------------|
| `realtime` | "el agente X está procesando task Y" | Cada hora |
| `fast` | "la versión actual es 2.1.0" | Cada día |
| `slow` | "Router-Jart está en :10200" | Cada semana |
| `never` | "el proyecto se creó en 2024" | Inmutable |

---

## 2. ContextRequest / ContextResponse

```json
// Request
{
  "query": "estado del sistema de memoria",
  "agent_id": "director",
  "token_budget": 2000,
  "min_score": 0.65,
  "collections": ["L0_L4_memory", "L3_facts"],
  "intent": "debug"
}

// Response
{
  "injection_text": "[JART-MEMORY: contexto semánticamente relevante]\n• [L3/0.91] Router-Jart en :10200\n• [L3/0.87] MCP-agent-memory usa Qdrant :6333\n[/JART-MEMORY]",
  "facts": [ ...array de MemoryFact... ],
  "token_estimate": 87,
  "retrieved_at": "2026-06-08T10:15:30Z",
  "latency_ms": 143.2,
  "profile": "ops"
}
```

**Reglas del injection_text:**
- Vacío si no hay facts con score > min_score
- Máximo `token_budget` tokens (estimación: len/4)
- Encabezado fijo: `[JART-MEMORY: contexto semánticamente relevante]`
- Pie fijo: `[/JART-MEMORY]`
- Un fact por línea: `• [L{layer}/{score:.2f}] {content}`
- Facts ordenados por score descendente

---

## 3. IngestRequest / IngestResponse

```json
// Request
{
  "content": "Decidido: usar BackpackAdapter en Fase A. Motivo: ya existe, zero cambios al MCP.",
  "event_type": "decision",
  "source": "director-agent",
  "actor_id": "director",
  "session_id": "session-20260608",
  "sync": false,
  "metadata": {
    "project": "jart-memory-enrichment",
    "phase": "A",
    "layer": 3,
    "change_speed": "slow"
  }
}

// Response
{
  "memory_id": "7f3a9b2c-...",
  "status": "queued",
  "collection": "L0_L4_memory",
  "created_at": "2026-06-08T10:16:00Z"
}
```

**event_type → colección destino inicial:**

| event_type | Colección inicial | Consolidación |
|-----------|------------------|---------------|
| `observation` | L0_L4_memory (L0) | → L1-L4 |
| `decision` | L0_L4_memory (L3) | Directo L3 |
| `fact` | L3_facts | Sin pipeline |
| `conversation` | L2_conversations | Sin pipeline |
| `error` | L0_L4_memory (L0) | → L1-L4 |
| `discovery` | L0_L4_memory (L3) | Directo L3 |
| `plan` | L0_L4_memory (L1) | → L3 |

---

## 4. EnrichRequest / EnrichResponse

```json
// Request (al endpoint /api/enrich de Router-Jart)
{
  "messages": [
    { "role": "system", "content": "Eres Ramiro..." },
    { "role": "user", "content": "revisa el estado del gateway" }
  ],
  "agent_id": "claude-code",
  "token_budget": 2000
}

// Response
{
  "messages": [
    {
      "role": "system",
      "content": "[JART-MEMORY: contexto semánticamente relevante]\n• [L3/0.89] LiteLLM proxy en :10201...\n[/JART-MEMORY]\n\nEres Ramiro..."
    },
    { "role": "user", "content": "revisa el estado del gateway" }
  ],
  "injection_text": "[JART-MEMORY:...]...",
  "facts_count": 2,
  "was_enriched": true,
  "latency_ms": 156.4,
  "degraded": false
}
```

**Regla de inyección en system prompt:**
- Si existe un mensaje `role: system` → el bloque `[JART-MEMORY...]` se **prepend** al inicio de su content
- Si no existe → se crea un mensaje `role: system` con solo el bloque de memoria
- Si el system prompt ya contiene `[JART-MEMORY` → no se modifica (idempotencia)

---

## 5. Configuración del EnrichmentMiddleware

```python
@dataclass
class EnrichmentConfig:
    enabled: bool = True
    memory_url: str = "http://localhost:8891"      # Jart-Core-Memory en Fase B
                                                    # http://localhost:8890 en Fase A (Backpack)
    token_budget: int = 2000
    min_score: float = 0.65
    timeout_ms: int = 500
    cache_ttl_s: int = 60
    injection_style: str = "block"                  # "block" | "inline"
    skip_agent_ids: list[str] = field(default_factory=list)
    
    @classmethod
    def from_env(cls) -> "EnrichmentConfig":
        return cls(
            enabled=os.getenv("ENRICHMENT_ENABLED", "true").lower() == "true",
            memory_url=os.getenv("ENRICHMENT_MEMORY_URL", "http://localhost:8891"),
            token_budget=int(os.getenv("ENRICHMENT_TOKEN_BUDGET", "2000")),
            min_score=float(os.getenv("ENRICHMENT_MIN_SCORE", "0.65")),
            timeout_ms=int(os.getenv("ENRICHMENT_TIMEOUT_MS", "500")),
            cache_ttl_s=int(os.getenv("ENRICHMENT_CACHE_TTL_S", "60")),
            skip_agent_ids=os.getenv("ENRICHMENT_SKIP_AGENT_IDS", "").split(","),
        )
```

---

## 6. Formato canónico del bloque de inyección

```
[JART-MEMORY: contexto semánticamente relevante]
• [L3/0.91] Router-Jart escucha en el puerto 10200
• [L3/0.87] LiteLLM proxy configurado en :10201 con modelo qwen25-director
• [L4/0.82] Proyecto jart-memory-enrichment: Fase A implementada, Fase B en curso
• [L2/0.71] Última sesión: discutida separación de Jart-Core-Memory del MCP
[/JART-MEMORY]
```

Este formato es:
- **Parseable** — markers de inicio/fin claros para detectar idempotencia
- **Legible** — el agente puede leerlo directamente
- **Compacto** — capa y score en el prefijo `[L{n}/{score}]`
- **Delimitado** — los agentes saben exactamente qué es memoria y qué es instrucción

---

## 7. Colecciones Qdrant (sin cambios)

| Colección | Dimensión | Tipo de índice | Descripción |
|-----------|-----------|---------------|-------------|
| `L0_L4_memory` | 1024 | Dense + Sparse | Memoria principal (todos los layers) |
| `L2_conversations` | 1024 | Dense | Resúmenes de conversaciones |
| `L3_facts` | 1024 | Dense | Hechos semánticos curados |
