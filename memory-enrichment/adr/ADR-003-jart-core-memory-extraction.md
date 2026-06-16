# ADR-003 — Extracción de Jart-Core-Memory como servicio autónomo

> Estado: PROPUESTO  
> Fecha: 2026-06-08  
> Relacionado: ADR-002  
> Impacto en: MCP-agent-memory, Router-Jart, launchd services, todos los clientes IDE

---

## Contexto

MCP-agent-memory (v2.1.0) actualmente implementa en un solo proceso:

1. **MCP stdio server** — tools para agentes (save, search, context)
2. **Embedding service** — llama-server como cliente interno (:9000)
3. **Qdrant management** — inicialización de colecciones, health checks
4. **Memory consolidation** — pipeline L0→L4 (background)
5. **Backpack HTTP API** — sidecar HTTP en :8890 para acceso externo
6. **File watchers** — vault_watcher, cowork_bridge, inbox scanner
7. **Background maintenance** — reembed, backup, watchdog
8. **Governance layer** — quality scoring, orphan detection

**Síntomas del sobreacoplamiento:**
- Si el servidor llama-server (:9000) cae, el MCP entero falla
- Testear cualquier tool requiere levantar toda la infraestructura
- El Backpack API vive como thread dentro del proceso MCP — no puede escalar independientemente
- Los background jobs compiten por recursos con el server MCP principal
- Añadir un nuevo backend de memoria (ej. Engram) requiere modificar el core del MCP

---

## Decisión

Extraer todas las responsabilidades de **infraestructura de memoria** a un servicio HTTP independiente llamado `jart-core-memory`, que expone una API REST simple y es consumido tanto por el MCP como por Router-Jart.

---

## Consecuencias

### Positivas

**Para MCP-agent-memory:**
- El servidor MCP arranca en < 3 segundos (sin inicializar Qdrant, sin cargar embedding)
- Las tools MCP se vuelven proxies delgados a jart-core-memory
- Testeable de forma aislada con un mock HTTP del core
- Puede reiniciarse sin perder conexiones de infraestructura

**Para Router-Jart:**
- Acceso directo a la API de memoria sin depender del proceso MCP
- Independencia total: si el MCP está caído, el enriquecimiento sigue funcionando
- Endpoint único y bien definido para retrieval

**Para la infraestructura:**
- Jart-Core-Memory puede tener su propio proceso launchd
- Puede escalar o migrarse a Docker sin afectar a los clientes
- Los background jobs tienen su propio lifecycle

### Negativas / Trade-offs

- Un nuevo servicio que operar y monitorear
- Latencia añadida por HTTP entre MCP y Jart-Core-Memory (< 5ms en local)
- Migración requiere que ambos sistemas corran en paralelo durante la transición
- La consolidación L0→L4 necesita acceso al modelo LLM — dependencia compartida con el MCP actual

---

## Alternativas consideradas

### Alt 1: Mantener Backpack API como está
El Backpack API (:8890) ya existe como sidecar del MCP. Se podría simplemente exponer ese endpoint al Router-Jart sin extraer nada.

**Rechazada porque**: sigue siendo un thread del proceso MCP (falla si el MCP falla), no tiene tests propios, y no resuelve el problema de acoplamiento a largo plazo.

### Alt 2: Mover todo a Router-Jart
Implementar el retrieval directamente en Router-Jart, sin servicio separado.

**Rechazada porque**: mezcla las responsabilidades de routing de LLM con las de gestión de memoria. Viola SRP y dificulta el testeo de cada componente.

### Alt 3: Extracción completa + eliminar MCP
Eliminar el servidor MCP y servir todas las tools como endpoints REST.

**Rechazada porque**: los IDEs (Claude Code, Cursor) están integrados con MCP. Cambiar esa integración requeriría modificar configuraciones en todos los clientes y perder el estándar.

---

## Separación de responsabilidades resultante

| Responsabilidad | Antes (en MCP) | Después |
|----------------|----------------|---------|
| Embedding computation | MCP process | Jart-Core-Memory |
| Qdrant management | MCP process | Jart-Core-Memory |
| Semantic retrieval | MCP L5_routing | Jart-Core-Memory /api/context |
| Memory ingestion | MCP L0_capture | Jart-Core-Memory /api/ingest |
| Memory consolidation L0→L4 | MCP background thread | Jart-Core-Memory + launchd job |
| Backpack HTTP API | MCP sidecar thread | Jart-Core-Memory (es el core) |
| File watchers (vault, inbox) | MCP launchd | launchd independiente → Jart-Core-Memory |
| MCP tools (save, search, context) | MCP | MCP (thin, proxy) |
| Enrichment for injection | — (no existía) | Router-Jart → Jart-Core-Memory |

---

## Contrato de migración

Durante la migración (Fase B), ambos sistemas coexisten:
- Backpack API (:8890) sigue activo — los clientes existentes no se rompen
- Jart-Core-Memory (:8891) levanta — los nuevos flujos lo usan
- Tras validación: Backpack API se depreca, MCP apunta a :8891
- Backpack API se elimina en Fase C

---

## Referencias

- `openapi-jart-core-memory.yaml` — spec completa del nuevo servicio
- `MIGRATION-PLAN.md` — pasos detallados con rollback
- `PHASE-B-memory-core.md` — guía de implementación
