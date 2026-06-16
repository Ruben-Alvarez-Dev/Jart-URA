# ADR-006 — Jart-BRAIN como capa cognitiva y plano de gobernanza

> Estado: PROPUESTO  
> Fecha: 2026-06-08  
> Relacionado: ADR-003, ADR-004, ADR-005  
> Impacto en: Jart-Core-Memory (split de responsabilidades), Router-Jart, MCP Backpack, Engram, NATS

---

## Contexto

En el diseño de las Fases A–D, Jart-Core-Memory acumula dos tipos de responsabilidades distintas:

1. **Infraestructura de memoria**: acceso a Qdrant, cómputo de embeddings, colecciones, pipeline L0→L4
2. **Lógica cognitiva**: qué es relevante ahora, cómo rankear, qué colección buscar primero, cuándo consolidar

El problema: la lógica cognitiva no debería vivir en el kernel de infraestructura. Si queremos cambiar cómo el sistema decide qué recuerdos son salientes (ej. añadir decay temporal, recencia, frecuencia de acceso, cruce entre agentes), tendríamos que modificar Jart-Core-Memory — que debería ser estable como infraestructura.

Adicionalmente, el principio de mandatory backpack (ADR-005) requiere un servicio que:
- Emita y valide tokens de identidad
- Gestione capabilities por agente
- Conozca qué agentes están activos (registro de sesiones)

Estos dos problemas (cognitivo + gobernanza) se resuelven con una capa nueva: **Jart-BRAIN**.

El nombre es una adaptación del concepto de **Global Brain / Global Workspace Theory** (Bernard Baars, 1988): la información que "gana la competencia de atención" se emite en broadcast a todos los módulos especializados. En Jart-OS: los recuerdos que JBRAIN considera salientes se inyectan en el contexto de todos los agentes activos.

---

## Decisión

Introducir `Jart-BRAIN` (:8892) como servicio nuevo con dos responsabilidades canónicas:

**1. Capa cognitiva**: decide QUÉ recuerdos son relevantes CUÁNDO y para QUIÉN.

**2. Plano de gobernanza**: gestiona la identidad de agentes, emite tokens, valida capabilities.

Jart-Core-Memory pierde la lógica cognitiva y queda como **kernel puro de infraestructura**: solo almacena, recupera y ejecuta operaciones vectoriales. No decide nada.

---

## Responsabilidades de Jart-BRAIN

### Módulo 1: Attention Engine

Recibe una señal de contexto (query extraída del mensaje del agente) y decide:
- En qué colecciones buscar (`L0_L4_memory`, `L3_facts`, `L2_conversations`)
- Con qué parámetros (`min_score`, `limit` adaptativo)
- Cómo ponderar los resultados (decay temporal, frecuencia de acceso, relevancia del agente solicitante)

```python
# Pseudocódigo del Attention Engine
async def attend(signal: ContextSignal, agent_id: str) -> AttentionPlan:
    profile = await agent_registry.get(agent_id)
    collections = route_by_signal_type(signal)
    weights = compute_weights(signal, profile.recent_topics)
    return AttentionPlan(collections=collections, weights=weights, budget=profile.token_budget)
```

### Módulo 2: Global Workspace

Estado compartido entre todos los agentes activos en la sesión:

```python
@dataclass
class GlobalWorkspace:
    active_agents: dict[str, AgentSession]    # {agent_id: session_info}
    broadcast_context: list[MemoryFact]       # hechos relevantes para todos
    session_topic: str                        # tema dominante de la sesión actual
    last_consolidated: datetime               # último ciclo de consolidación
```

Cuando un agente hace una búsqueda y obtiene resultados de alta puntuación, JBRAIN puede **broadcastear** esos hechos al workspace compartido — otros agentes activos los reciben sin tener que buscarlos de nuevo.

### Módulo 3: Memory Router

Determina la ruta óptima para cada tipo de petición:

| Tipo de señal | Colección primaria | Colección secundaria |
|--------------|-------------------|---------------------|
| Código / técnico | `L3_facts` | `L0_L4_memory` |
| Conversación / contexto | `L2_conversations` | `L0_L4_memory` |
| Conceptual / semántico | `L0_L4_memory` | `L3_facts` |
| Ingesta de evento | routing por `event_type` | — |

### Módulo 4: Salience Scorer

Re-rankea los resultados de Jart-Core-Memory aplicando factores cognitivos:

```
score_final = score_vectorial
            × decay(tiempo_desde_creación)
            × boost_si_mismo_agente_creó
            × boost_si_accedido_recientemente
            × boost_si_en_broadcast_workspace
```

### Módulo 5: Consolidation Orchestrator

JBRAIN decide CUÁNDO y QUÉ consolidar (L0→L4). Jart-Core-Memory ejecuta la consolidación, pero no la inicia por su cuenta.

Triggers de consolidación:
- `count(L0_raw) > threshold` (umbral configurable)
- Señal de "fin de sesión" desde la backpack (NATS `jart.agent.{id}.control`)
- Schedule periódico (reemplaza el launchd `com.agent-memory.lifecycle.plist`)

### Módulo 6: Governance Plane

El governance plane es la parte del JBRAIN que implementa el mandatory backpack (ADR-005):

```
POST /api/register    → recibe agent_id + client_type → emite JWT + NATS credentials
POST /api/deregister  → invalida sesión del agente
POST /api/validate    → valida un token (llamado por otros servicios)
GET  /api/agents      → lista de agentes activos (para Global Workspace)
```

JWT emitido por JBRAIN:
```json
{
  "iss": "jart-brain",
  "sub": "{agent_id}",
  "client_type": "claude-code",
  "capabilities": ["memory:read", "memory:write", "nats:subscribe"],
  "rate_limits": {"context_per_min": 60},
  "exp": 1234567890
}
```

Firmado con clave simétrica compartida entre JBRAIN y los servicios que validan (HS256 en fase local, RS256 si se hace multi-nodo).

---

## API de Jart-BRAIN (:8892)

### Endpoints cognitivos

```
POST /api/context
  Body: {query, agent_id, token_budget, session_id}
  → llama Core-Memory, aplica Attention + Salience, devuelve injection_text + facts

POST /api/think
  Body: {query, agent_id, intent: "answer"|"store"|"consolidate"}
  → versión extendida de /api/context con plan de acción

POST /api/ingest
  Body: {content, event_type, agent_id, session_token}
  → decide colección, llama Core-Memory /api/ingest

POST /api/consolidate
  Body: {agent_id, dry_run}
  → evalúa necesidad, llama Core-Memory /api/consolidate si procede
```

### Endpoints de gobernanza

```
POST /api/register      → registro de nuevo agente (emite token)
POST /api/deregister    → cierre de sesión
GET  /api/validate      → validación de token (para otros servicios)
GET  /api/agents        → agentes activos en workspace
GET  /api/workspace     → estado del Global Workspace actual
GET  /api/health        → health del JBRAIN + dependencias
```

---

## Flujo de llamadas actualizado

### Flujo 1: Auto-inyección (Router-Jart)

```
Prompt → Router :10200
  → EnrichmentMiddleware
  → JBRAIN :8892 POST /api/context {agent_id desde X-Jart-Agent-Id}
    → JBRAIN valida token
    → Attention Engine → Memory Router → Core-Memory :8891 POST /api/search
    → Salience Scorer → injection_text
  → [JART-MEMORY:...] inyectado en system prompt
  → Forward a LiteLLM
```

### Flujo 2: Tool MCP (desde backpack)

```
IDE → MCP tool memory_context
  → Backpack (con X-Jart-Agent-Token)
  → JBRAIN :8892 POST /api/context
  → mismo flujo que arriba
  → context packet → tool response → IDE
```

### Flujo 3: Ingesta de evento

```
cowork_bridge / hook IDE
  → Backpack (identifica agente)
  → Engram :3100 (buffer)
  → JBRAIN POST /api/ingest
  → Core-Memory :8891 POST /api/ingest
  → Qdrant
```

### Flujo 4: Arranque de backpack

```
IDE arranca → carga MCP Backpack
  → POST http://localhost:8892/api/register
  → JBRAIN emite JWT + NATS credentials
  → Backpack operativa, agente registrado en Global Workspace
```

---

## Separación de responsabilidades resultante

| Responsabilidad | Antes (Fases A-D) | Después (con JBRAIN) |
|----------------|-------------------|---------------------|
| Decidir qué colección buscar | Core-Memory (implícito) | JBRAIN Memory Router |
| Ponderar resultados por relevancia | Core-Memory (básico) | JBRAIN Salience Scorer |
| Estado compartido entre agentes | No existe | JBRAIN Global Workspace |
| Decidir cuándo consolidar | launchd schedule | JBRAIN Consolidation Orchestrator |
| Emitir tokens de identidad | No existe | JBRAIN Governance Plane |
| Validar tokens | No existe | JBRAIN Governance Plane |
| Registro de agentes activos | No existe | JBRAIN Agent Registry |
| Almacenamiento vectorial | Core-Memory | Core-Memory (sin cambio) |
| Embedding computation | Core-Memory | Core-Memory (sin cambio) |
| Pipeline L0→L4 (ejecución) | Core-Memory | Core-Memory (sin cambio) |
| Tools MCP (interfaz IDE) | MCP slim | MCP slim (sin cambio) |
| Scheduling de background jobs | MCP launchd | MCP launchd (CUÁNDO) → JBRAIN (QUÉ) |

---

## Consecuencias

### Positivas

- **Infraestructura estable**: Jart-Core-Memory no cambia cuando cambia la estrategia cognitiva
- **Cognitiva extensible**: añadir decay temporal, boost por frecuencia, o nuevas estrategias de retrieval → solo tocar JBRAIN
- **Global Workspace**: primera vez que existe contexto compartido entre agentes — sin búsquedas duplicadas
- **Gobernanza centralizada**: un solo lugar para capabilities, rate limits, auditoría
- **Auditoría completa**: todo pasa por JBRAIN → registro de qué agente hizo qué

### Negativas / Trade-offs

- **Un salto más de red**: cada operación de memoria es ahora Router→JBRAIN→Core-Memory en lugar de Router→Core-Memory. Coste: ~5-10ms adicionales en localhost.
- **Nuevo servicio que operar**: JBRAIN tiene su propio launchd plist y ciclo de vida
- **JBRAIN como SPOF**: si JBRAIN cae, la inyección de memoria se detiene. Mitigación: modo degradado en todos los servicios (pasan el request sin enriquecer)
- **Complejidad de implementación**: el governance plane (JWT, NATS credentials) es el componente más nuevo y sin precedente en el stack

### Mitigación del SPOF

```python
# En EnrichmentMiddleware (Router-Jart):
try:
    result = await gbrain.context(query, timeout_ms=450)
except (TimeoutError, JBRAINUnavailable):
    # modo degradado: sin memoria pero el agente sigue funcionando
    return original_messages
```

```python
# En MCP Backpack (al arrancar):
try:
    token = await gbrain.register(agent_id, client_type)
except JBRAINUnavailable:
    token = DegradedToken()  # capabilities: [], no NATS
    # el IDE sigue funcionando, sin contexto de memoria
```

---

## Alternativas consideradas

### Alt 1: Mantener lógica cognitiva en Jart-Core-Memory
No introducir JBRAIN — ampliar Core-Memory con los módulos cognitivos.

**Rechazada porque**: mezcla infraestructura con cognición. Cualquier cambio en estrategia de retrieval requiere tocar el kernel. La infraestructura debería ser estable; la cognición, flexible.

### Alt 2: Lógica cognitiva en Router-Jart
El EnrichmentMiddleware hace el scoring y routing directamente.

**Rechazada porque**: el Router es un proxy de transport — no debería conocer la semántica de los recuerdos. Además, los MCP tools también necesitan la lógica cognitiva — no solo el Router.

### Alt 3: JBRAIN como librería (in-process)
No un servicio HTTP — una librería Python importada por Router y MCP.

**Rechazada porque**: pierde el Global Workspace (no se puede compartir estado entre procesos), y pierde el governance plane (no se puede validar tokens entre servicios con una librería embebida).

---

## Fases de implementación

| Fase | Alcance de este ADR |
|------|---------------------|
| A–D | Sin JBRAIN. Core-Memory hace retrieval directamente. Backpack es façade. |
| E | Implementar JBRAIN. Mover lógica cognitiva desde Core-Memory. Governance plane básico (JWT). |
| F | NATS broker. Backpack gestiona credenciales NATS. Global Workspace activo. |

La transición A→D → E es no-disruptiva: JBRAIN se pone delante de Core-Memory; los contratos de API de Router y MCP hacia Core-Memory se cambian a JBRAIN. Rollback: apuntar Router y MCP directamente a Core-Memory (Fase D).

---

## Puertos del ecosistema completo (post Fase F)

| Servicio | Puerto | Rol |
|---------|--------|-----|
| Router-Jart | :10200 | Transport proxy + EnrichmentMiddleware |
| LiteLLM | :10201 | LLM proxy |
| Jart-BRAIN | :8892 | Cognitivo + Governance |
| Jart-Core-Memory | :8891 | Kernel de memoria (infraestructura) |
| Engram | :3100 | Bus de eventos (ingesta async) |
| NATS broker | :4222 | Bus de comunicaciones internas |
| Qdrant | :6333 | Base de datos vectorial |
| Embedding | :9000 | Modelo de embedding |

---

## Referencias

- `ADR-005-mcp-backpack-mandatory-identity-gateway.md` — el sidecar que se registra en JBRAIN
- `ADR-003-jart-core-memory-extraction.md` — Core-Memory como kernel de infraestructura
- `PHASE-E-jbrain.md` (a crear) — guía de implementación de JBRAIN
- `ROADMAP.md` — fases E y F añadidas con este ADR
