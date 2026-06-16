# Jart Memory Enrichment — Project Roadmap

> **Proyecto**: jart-memory-enrichment  
> **Estado**: PLANIFICACIÓN  
> **Versión**: 2.0.0  
> **Fecha**: 2026-06-08  
> **Propietario**: Rubén / Ramiro 🐺  
> **Relacionado con**: ADR-002, ADR-003, ADR-005, ADR-006, jart-gateway-plan.md

---

## 0. Principios de diseño P0

Estos principios son invariantes. Ninguna decisión de implementación puede violarlos.

### P0.1 — La mochila es la llave (Mandatory Backpack)

El MCP Backpack es el **único punto de entrada contractual al ecosistema Jart-OS** para cualquier agente. Sin backpack activo con token válido, los servicios internos no sirven contexto de memoria, no aceptan ingesta, y el agente no puede publicar en el bus NATS.

El rechazo es automático y sin configuración — es la arquitectura, no una política.

> Metáfora de referencia: los carritos de Mercadona. La rueda se tranca al salir del perímetro. No es configurable, es físico.

→ Ver ADR-005

### P0.2 — Separación cognitivo / infraestructura

Jart-BRAIN decide QUÉ recuerdos son relevantes CUÁNDO y PARA QUIÉN.  
Jart-Core-Memory almacena, recupera y ejecuta — no decide nada.

Ningún cambio en estrategia cognitiva (scoring, decay, routing de colecciones) debe tocar el kernel de infraestructura.

→ Ver ADR-006

### P0.3 — Degradación silenciosa en toda la cadena

Si cualquier servicio del stack de memoria no responde en el timeout configurado, el request del agente continúa **sin enriquecer pero sin error**. La memoria mejora la experiencia — nunca la bloquea.

### P0.4 — El agente no cambia su interfaz

Los tools MCP tienen los mismos nombres, contratos y comportamiento observable antes y después de cualquier fase de migración. Los IDEs no requieren reconfiguración.

---

## 1. Visión y objetivos

### Problema a resolver

El sistema MCP-agent-memory almacena y procesa memoria correctamente, pero **esa memoria nunca llega automáticamente a los agentes**. El protocolo MCP es pull-only: los agentes deben pedir contexto explícitamente. En la práctica no lo hacen de forma consistente.

Además, MCP-agent-memory acumula demasiadas responsabilidades (embedding, Qdrant, consolidación, HTTP API, background jobs, MCP tools), lo que genera acoplamiento, fragilidad y dificultad para testear cada pieza.

No existe gobernanza de identidad: cualquier proceso del sistema puede acceder a la memoria de cualquier agente sin identificarse.

### Objetivo principal

**Inyección automática y universal de contexto de memoria** en todos los clientes (Claude Code, Cursor, Windsurf, Cowork, cualquier cliente OpenAI-compatible), con identidad de agente, gobernanza y comunicaciones internas.

### Objetivos secundarios

1. Separar `jart-core-memory` como servicio HTTP autónomo (kernel de infraestructura)
2. Introducir `Jart-BRAIN` como capa cognitiva y plano de gobernanza
3. Convertir MCP Backpack en sidecar de agente con identidad, NATS y governance
4. Adelgazar MCP-agent-memory a solo tools de agente (façade pura)
5. Que Router-Jart (:10200) sea el punto único de enriquecimiento en el transporte
6. Arquitectura testeable, observable y extensible

---

## 2. Fases del proyecto

```
FASE 0       FASE A        FASE B         FASE C        FASE D        FASE E        FASE F
Auditoría → Quick Win → Memory Core → MCP Slim   → Clients   → JBRAIN    → NATS+Identity
(2 días)   (3-4 días)   (5-7 días)   (3-4 días)  + Obs.     Cognitivo   Governance
                                                   (3-4 días) (5-7 días)  (4-5 días)

──────────── Fases de memoria e inyección ────────────── ── Fases de ecosistema ────────
```

**Fases A–D**: inyección de memoria, extracción de Core-Memory, slim del MCP.  
**Fases E–F**: JBRAIN como capa cognitiva + plano de identidad, NATS + Backpack como sidecar obligatorio.

---

## 3. Fase 0 — Auditoría y baseline (2 días)

### Objetivo
Documentar el estado actual antes de tocar nada. Tener métricas de referencia.

### Entregables

| # | Entregable | Descripción |
|---|-----------|-------------|
| 0.1 | `STATE-AUDIT.md` | Inventario de servicios activos, puertos, versiones |
| 0.2 | `BENCHMARK-BASELINE.md` | Latencia actual de request_context, counts Qdrant |
| 0.3 | `DEPENDENCY-MAP.md` | Mapa de qué llama a qué actualmente |
| 0.4 | Tests de humo pasando | pytest smoke.py verde antes de cualquier cambio |

### Criterios de aceptación
- [ ] Todos los servicios documentados con puerto, PID, comando de arranque
- [ ] Latencia p50/p95 de `/api/request-context` medida y registrada
- [ ] Count de documentos en cada colección Qdrant registrado
- [ ] Tests de humo ejecutables y verdes

---

## 4. Fase A — Quick Win: EnrichmentMiddleware sobre Backpack API (3-4 días)

### Objetivo
Inyección automática funcionando en 4 días, sin tocar MCP-agent-memory. Usa el Backpack API (:8890) que ya existe.

### Arquitectura de esta fase

```
Cliente → Router-Jart(:10200) → EnrichmentMiddleware → Backpack API(:8890)
                                         ↓
                               messages enriquecidos
                                         ↓
              Router-Jart → LiteLLM(:10201) / vLLM(:9000)
```

### Entregables

| # | Entregable | Tipo | Descripción |
|---|-----------|------|-------------|
| A.1 | `openapi-enrichment-endpoint.yaml` | Spec | OpenAPI 3.1 del endpoint `/api/enrich` |
| A.2 | `enrichment/core/ports.py` | Código | Interfaces IMemoryRetriever, IContextExtractor |
| A.3 | `enrichment/core/models.py` | Código | MemoryFact, MemoryResult, EnrichmentConfig |
| A.4 | `enrichment/core/service.py` | Código | EnrichmentService (orquestador) |
| A.5 | `enrichment/adapters/memory/backpack.py` | Código | BackpackMemoryAdapter |
| A.6 | `enrichment/adapters/extraction/message.py` | Código | MessageContextExtractor |
| A.7 | `enrichment/adapters/injection/system_prompt.py` | Código | SystemPromptInjector |
| A.8 | `enrichment/middleware.py` | Código | FastAPI middleware |
| A.9 | `enrichment/factory.py` | Código | build_service() desde env vars |
| A.10 | Tests unitarios suite completa | Tests | Coverage > 85% en service + adapters |
| A.11 | `POST /api/enrich` en Router-Jart | Código | Endpoint standalone para hooks de cliente |
| A.12 | `memory_inject.py` hook | Script | Hook Claude Code / universal |

### Criterios de aceptación
- [ ] `POST /api/enrich` responde en < 300ms p95 con Backpack API levantado
- [ ] Degradación silenciosa: si Backpack API está caído, request pasa intacta
- [ ] No se inyecta si el system prompt ya contiene `[JART-MEMORY`
- [ ] Tests unitarios verdes con `NullMemoryAdapter`
- [ ] Tests de integración verdes con Backpack API real
- [ ] Claude Code recibe memoria relevante en sesión real de proyecto

### Riesgos Fase A

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Backpack API no estable con carga | Media | Alto | Timeout 500ms + circuit breaker |
| Latencia añadida > 500ms | Baja | Medio | Cache LRU por query hash |
| Inyección demasiado verbosa (tokens) | Media | Medio | token_budget configurable vía env |

---

## 5. Fase B — jart-core-memory: extracción del núcleo (5-7 días)

### Objetivo
Extraer las responsabilidades de infraestructura de memoria de MCP-agent-memory a un servicio HTTP autónomo (`jart-core-memory`). Este servicio reemplaza al Backpack API como backend de enriquecimiento.

### Arquitectura objetivo de esta fase

```
              ┌─────────────────────────────┐
              │     Jart-Core-Memory         │
              │     http://localhost:8891    │
              │                             │
              │  /api/context   /api/ingest │
              │  /api/search    /api/embed  │
              │  /api/health    /api/stats  │
              │                             │
              │  [Qdrant :6333]             │
              │  [Embedding :9000]          │
              │  [Consolidation worker]     │
              └───────────┬─────────────────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
    ┌──────────────────┐   ┌──────────────────────┐
    │  MCP-agent-memory│   │  Router-Jart         │
    │  (thin, tools)   │   │  EnrichmentMiddleware│
    │                  │   │  → BackpackAdapter   │
    │  save, search,   │   │    ↓ apunta a :8891  │
    │  context (proxy) │   │    en vez de :8890   │
    └──────────────────┘   └──────────────────────┘
```

### Entregables

| # | Entregable | Tipo | Descripción |
|---|-----------|------|-------------|
| B.1 | `openapi-jart-core-memory.yaml` | Spec | OpenAPI 3.1 completo del servicio |
| B.2 | `data-models.md` | Spec | JSON Schema de todos los modelos |
| B.3 | `jart-core-memory/src/app.py` | Código | FastAPI app principal |
| B.4 | `jart-core-memory/src/routes/context.py` | Código | POST /api/context |
| B.5 | `jart-core-memory/src/routes/ingest.py` | Código | POST /api/ingest |
| B.6 | `jart-core-memory/src/routes/search.py` | Código | POST /api/search |
| B.7 | `jart-core-memory/src/routes/embed.py` | Código | POST /api/embed |
| B.8 | `jart-core-memory/src/services/retrieval.py` | Código | SmartRetrievalService |
| B.9 | `jart-core-memory/src/services/ingest.py` | Código | IngestionService |
| B.10 | `jart-core-memory/src/infra/qdrant.py` | Código | Qdrant client wrapper |
| B.11 | `jart-core-memory/src/infra/embedding.py` | Código | Embedding client |
| B.12 | `jart-core-memory/docker-compose.yml` | Infra | Servicio en Docker / launchd plist |
| B.13 | `jart-core-memory/tests/` | Tests | Suite completa, coverage > 90% |
| B.14 | Actualizar BackpackAdapter | Código | Apuntar a :8891 (nuevo servicio) |
| B.15 | `MIGRATION-B.md` | Doc | Pasos de migración con rollback |

### Criterios de aceptación
- [ ] Todos los endpoints de la spec OpenAPI implementados y respondiendo
- [ ] `jart-core-memory` pasa tests de integración contra Qdrant real
- [ ] Backpack API (:8890) sigue funcionando en paralelo (no romper clientes existentes)
- [ ] Router-Jart usa Jart-Core-Memory (:8891) para enriquecimiento
- [ ] Latencia de `/api/context` < 200ms p95
- [ ] Background jobs (consolidación, reembed) operando via jart-core-memory

### Riesgos Fase B

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Duplicación de conexiones a Qdrant | Media | Bajo | Pool compartido via config |
| Migración de background jobs compleja | Alta | Medio | Mantener launchd existente, solo redirigir endpoints |
| Regresión en consolidación L0→L4 | Media | Alto | Tests de regresión en Fase 0 antes de migrar |

---

## 6. Fase C — MCP Slim: adelgazar MCP-agent-memory (3-4 días)

### Objetivo
Con `jart-core-memory` estable, reducir MCP-agent-memory a lo que le corresponde: tools de agente. Eliminar todo lo que ahora hace como infraestructura.

### Entregables

| # | Entregable | Tipo | Descripción |
|---|-----------|------|-------------|
| C.1 | `MCP-slim-spec.md` | Spec | Inventario de tools que quedan vs las que se eliminan |
| C.2 | MCP server refactorizado | Código | Solo tools: save, search, context (proxy a jart-core-memory) |
| C.3 | Eliminar Backpack API del MCP | Código | `api_server.py` → deprecado, eliminado de `main.py` |
| C.4 | Eliminar background jobs del MCP | Infra | Mover a launchd independiente que llama a Jart-Core-Memory |
| C.5 | Tests de regresión MCP | Tests | Verificar que todas las tools siguen funcionando |
| C.6 | Actualizar mcp.json en todos los clientes | Config | Claude, Cursor, Windsurf, VS Code |

### Criterios de aceptación
- [ ] MCP-agent-memory arranca en < 3 segundos (sin inicializar infraestructura)
- [ ] Todas las MCP tools responden correctamente (proxean a jart-core-memory)
- [ ] Backpack API (:8890) ya no existe como proceso
- [ ] Background jobs (consolidación, watchdog) corren como launchd independientes
- [ ] Zero regresiones en tests de tools MCP

---

## 7. Fase D — Clients + Observabilidad (3-4 días)

### Objetivo
Adaptar todos los clientes al nuevo sistema. Añadir métricas y logging para operar el sistema en producción.

### Entregables

| # | Entregable | Tipo | Descripción |
|---|-----------|------|-------------|
| D.1 | `memory_inject.py` hook activo | Script | Claude Code UserPromptSubmit |
| D.2 | Equivalente para Cursor | Script | `.cursor/hooks/` equivalente |
| D.3 | Equivalente para Windsurf | Script | Windsurf hooks config |
| D.4 | `disableAllHooks: false` en settings.json | Config | Activar hooks Claude Code |
| D.5 | Métricas Prometheus en Jart-Core-Memory | Código | Latencia, hit rate, error rate |
| D.6 | Métricas en EnrichmentMiddleware | Código | Enrichment rate, token injection avg |
| D.7 | Dashboard Grafana "Memory Enrichment" | Infra | Panel: injection rate, latencia, score avg |
| D.8 | Runbook operacional | Doc | Cómo arrancar, parar, depurar cada componente |

### Criterios de aceptación
- [ ] Hook activo y funcionando en Claude Code (test en sesión real)
- [ ] Tasa de enriquecimiento > 60% de turnos en sesión de proyecto
- [ ] Score promedio de facts inyectados > 0.70
- [ ] Dashboard Grafana mostrando datos reales
- [ ] Runbook completo y revisado

---

## 8. Fase E — Jart-BRAIN: capa cognitiva y governance plane (5-7 días)

### Objetivo

Introducir Jart-BRAIN (:8892) como servicio nuevo. Mover la lógica cognitiva desde Jart-Core-Memory. Implementar el governance plane que emite tokens de identidad para las backpacks.

### Prerrequisitos
Fase D completa. Jart-Core-Memory estable en producción.

### Arquitectura objetivo

```
Router-Jart → JBRAIN :8892 → Core-Memory :8891
MCP Backpack → JBRAIN :8892 → Core-Memory :8891
IDE arranca → Backpack → JBRAIN /api/register → JWT emitido
```

### Entregables

| # | Entregable | Tipo | Descripción |
|---|-----------|------|-------------|
| E.1 | `jart-brain/src/main.py` | Código | FastAPI app + lifespan |
| E.2 | `jart-brain/src/cognitive/attention.py` | Código | Attention Engine |
| E.3 | `jart-brain/src/cognitive/workspace.py` | Código | Global Workspace |
| E.4 | `jart-brain/src/cognitive/router.py` | Código | Memory Router (qué colección) |
| E.5 | `jart-brain/src/cognitive/salience.py` | Código | Salience Scorer |
| E.6 | `jart-brain/src/cognitive/consolidation.py` | Código | Consolidation Orchestrator |
| E.7 | `jart-brain/src/governance/plane.py` | Código | Governance plane: register, validate |
| E.8 | `jart-brain/src/governance/token.py` | Código | JWT mint + validation (HS256) |
| E.9 | `jart-brain/src/governance/registry.py` | Código | Agent Registry (agentes activos) |
| E.10 | Actualizar Router-Jart | Código | Llamar a JBRAIN en vez de Core-Memory |
| E.11 | Actualizar MCP Backpack | Código | POST /api/register al arrancar |
| E.12 | `deploy/com.jart-brain.plist` | Infra | launchd plist para :8892 |
| E.13 | `PHASE-E-jbrain.md` | Doc | Guía de implementación |

### Criterios de aceptación
- [ ] JBRAIN responde en /api/context con enrichment equivalente a Fase D (no-regresión)
- [ ] Backpack obtiene JWT al arrancar y lo incluye en todas las llamadas
- [ ] Core-Memory rechaza llamadas sin origen válido (JBRAIN o Router)
- [ ] Global Workspace activo — agentes activos visibles en /api/agents
- [ ] Latencia total enriquecimiento < 250ms p95 (vs 200ms Fase D — margen aceptable)

---

## 9. Fase F — NATS + Identidad + Governance completa (4-5 días)

### Objetivo

Levantar el broker NATS (:4222). La MCP Backpack gestiona credenciales NATS recibidas de JBRAIN. El "carro de Mercadona" queda completamente operativo: sin backpack = sin acceso a nada.

### Prerrequisitos
Fase E completa. JWT funcionando entre backpack, JBRAIN y Core-Memory.

### Entregables

| # | Entregable | Tipo | Descripción |
|---|-----------|------|-------------|
| F.1 | NATS broker configurado | Infra | :4222, TLS local, credenciales por agente |
| F.2 | `jart-brain/src/governance/nats_creds.py` | Código | Emisión de credenciales NATS por registro |
| F.3 | Actualizar MCP Backpack | Código | Cliente NATS con credenciales de JBRAIN |
| F.4 | Tópicos NATS definidos | Spec | jart.agent.*.events, jart.memory.ingest, etc. |
| F.5 | Jart-Core-Memory: enforcement | Código | Rechaza sin token JBRAIN válido |
| F.6 | Engram: integración NATS | Código | Publica eventos recibidos → JBRAIN |
| F.7 | `PHASE-F-nats-identity.md` | Doc | Guía de implementación |
| F.8 | `scripts/verify-full-ecosystem.sh` | Script | Verificación end-to-end del ecosistema completo |

### Criterios de aceptación
- [ ] Backpack sin token → todos los servicios responden 403 o modo degradado
- [ ] Backpack con token → flujo completo funcionando
- [ ] Eventos de ingesta llegan a Core-Memory vía NATS + Engram
- [ ] `verify-full-ecosystem.sh` pasa 100%
- [ ] Un agente sin mochila no puede leer ni escribir memoria de ningún agente con mochila

---

## 10. Mapa de dependencias entre fases

```
Fase 0 (Auditoría)
  └── Fase A (Quick Win)           [no bloquea B, pueden solaparse]
        └── Fase B (Memory Core)
              ├── Fase C (MCP Slim)
              │     └── Fase D (Clients + Observabilidad)
              │                └── Fase E (JBRAIN Cognitivo + Governance)
              │                          └── Fase F (NATS + Identidad completa)
              └── Fase D puede empezar con Fase A completa
```

Secuencia recomendada:
1. `0 → A` en paralelo con B.1-B.2 (escribir specs mientras se implementa A)
2. `A estable → B` (implementar memory-core con specs ya escritas)
3. `B estable → C` (slim MCP cuando memory-core está probado)
4. `A completo + C completo → D` (clients y observabilidad al final)
5. `D estable → E` (JBRAIN sobre stack probado — no introducir durante migración)
6. `E estable → F` (NATS solo cuando JWT funciona — añadir una capa a la vez)

---

## 11. Stack tecnológico

| Componente | Tecnología | Puerto | Versión mínima |
|-----------|-----------|--------|---------------|
| Router-Jart | Python + FastAPI | :10200 | 3.12 / 0.115 |
| LiteLLM | LiteLLM proxy | :10201 | latest |
| Jart-BRAIN | Python + FastAPI | :8892 | 3.12 / 0.115 (Fase E) |
| Jart-Core-Memory | Python + FastAPI | :8891 | 3.12 / 0.115 |
| Engram | Engram server | :3100 | — |
| NATS broker | NATS Server | :4222 | 2.10+ (Fase F) |
| Embedding | llama-server (bge-m3) | :9000 | local |
| Vector DB | Qdrant | :6333 | latest |
| Infra local | launchd (macOS) | — | — |
| Infra Docker | Docker Compose | — | 3.9+ |
| Tests | pytest + pytest-asyncio + httpx | — | latest |
| Observabilidad | Prometheus + Grafana | — | latest |
| Auth tokens | PyJWT (HS256 local, RS256 multi-nodo) | — | 2.8+ (Fase E) |
| Spec format | OpenAPI 3.1 (YAML) | — | — |

---

## 12. Registro de decisiones (ADRs)

| ADR | Título | Estado | Fases |
|-----|--------|--------|-------|
| ADR-001 | Project entity metadata convention | Aceptado | — |
| ADR-002 | Memory enrichment architecture (hexagonal) | Propuesto | A–D |
| ADR-003 | Extracción de Jart-Core-Memory como servicio autónomo | Propuesto | B |
| ADR-004 | Router-Jart como punto único de enriquecimiento | Propuesto | A |
| ADR-005 | MCP Backpack como gateway de identidad obligatorio | Propuesto | E–F |
| ADR-006 | Jart-BRAIN como capa cognitiva y plano de gobernanza | Propuesto | E–F |

---

## 13. Registro de riesgos global

| ID | Riesgo | Fase | Prob. | Impacto | Plan de mitigación |
|----|--------|------|-------|---------|-------------------|
| R01 | Backpack API inestable bajo carga | A | Media | Alto | Circuit breaker + timeout 500ms |
| R02 | Regresión en consolidación L0→L4 | B | Media | Alto | Snapshot Qdrant antes de migrar |
| R03 | MCP tools rotas tras slim | C | Baja | Alto | Test suite completa antes de slim |
| R04 | Cowork no recibe enriquecimiento | D | Alta | Medio | Cowork usa Router-Jart → automático |
| R05 | Latencia total > 500ms | A-B | Baja | Medio | Cache LRU por query + async paralelo |
| R06 | Datos perdidos durante migración Qdrant | B | Baja | Crítico | Backup completo + smoke tests |
| R07 | JBRAIN como SPOF — si cae, sin memoria | E | Media | Alto | Modo degradado en Router y Backpack |
| R08 | Regresión cognitiva al mover lógica a JBRAIN | E | Media | Alto | Tests de no-regresión contra Fase D |
| R09 | NATS broker — complejidad de credenciales | F | Alta | Medio | JWT primero, NATS solo en Fase F |
| R10 | Backpack sin JBRAIN no puede arrancar | E-F | Media | Alto | Modo degradado: backpack arranca sin token |

---

## 14. Definición de "Done" por fase

- **Fase 0**: Todos los entregables documentados + tests de humo verdes
- **Fase A**: Memoria inyectada en sesión real de Claude Code sin acción del agente
- **Fase B**: Jart-Core-Memory corriendo standalone, testeable de forma aislada
- **Fase C**: MCP arranca en < 3s, sin Backpack API, sin background jobs propios
- **Fase D**: Dashboard activo + tasa de enriquecimiento > 60% en sesión real
- **Fase E**: JBRAIN emite tokens, Router y MCP los validan; lógica cognitiva no-regresión vs Fase D
- **Fase F**: Backpack sin token = 403 en todos los servicios; NATS operativo; `verify-full-ecosystem.sh` pasa 100%

---

## 15. Documentos relacionados

```
memory-enrichment/
├── ROADMAP.md                               ← este documento
├── adr/
│   ├── ADR-003-jart-core-memory-extraction.md
│   ├── ADR-004-enrichment-router-placement.md
│   ├── ADR-005-mcp-backpack-mandatory-identity-gateway.md  ← Fase E-F
│   └── ADR-006-jart-brain-cognitive-layer.md              ← Fase E-F
├── specs/
│   ├── openapi-jart-core-memory.yaml        ← API spec Core-Memory
│   ├── openapi-router-jart-enrichment.yaml  ← API spec Router enrichment
│   └── data-models.md                       ← JSON Schema modelos
├── implementation/
│   ├── PHASE-A-quickwin.md
│   ├── PHASE-B-memory-core.md
│   ├── PHASE-C-mcp-slim.md
│   ├── PHASE-D-clients-observability.md
│   ├── PHASE-E-jbrain.md                    ← a crear
│   └── PHASE-F-nats-identity.md             ← a crear
└── migration/
    └── MIGRATION-PLAN.md

../ADR-002-memory-enrichment-architecture.md  ← arquitectura hexagonal
../jart-gateway-plan.md                        ← plan vLLM + LiteLLM
```
