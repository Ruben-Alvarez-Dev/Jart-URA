# Plan de Migración y Cambios en Cascada

> **Versión**: 1.0 — 2026-06-08  
> **Alcance**: Todos los proyectos y configuraciones afectados por la introducción del sistema de inyección de memoria

---

## Mapa de proyectos afectados

```
PROYECTOS PRIMARIOS (código cambia)
├── Jart-Core-Memory (NUEVO — /Users/ruben/Code/jart-core-memory/)
├── Jart-OS/TIERS/TIER-02-GATEWAY/10200-router-jart/  (EnrichmentMiddleware)
└── MCP-agent-memory (/Users/ruben/MCP-servers/MCP-agent-memory/)

CONFIGURACIÓN DE CLIENTES (archivos de configuración)
├── Claude Code (~/.claude/settings.json + hooks/)
├── Cursor (~/.cursor/mcp.json + hooks/)
├── Windsurf (~/.codeium/windsurf/mcp.json + hooks/)
└── VS Code Insiders (Library/Application Support/Code - Insiders/User/)

SERVICIOS macOS (launchd plists)
├── ~/Library/LaunchAgents/com.agent-memory.plist            (MCP — sin cambios)
├── ~/Library/LaunchAgents/com.agent-memory.backpack-api.plist  (DEPRECAR)
├── ~/Library/LaunchAgents/com.jart-core-memory.plist        (NUEVO)
├── ~/Library/LaunchAgents/com.agent-memory.lifecycle.plist  (ACTUALIZAR URL)
├── ~/Library/LaunchAgents/com.agent-memory.reembed.plist    (ACTUALIZAR URL)
└── ~/Library/LaunchAgents/com.agent-memory.cowork-bridge.plist (ACTUALIZAR URL)

SCRIPTS (shell/python)
├── /Users/ruben/MCP-servers/MCP-agent-memory/scripts/cowork_bridge.sh
└── /Users/ruben/.claude/hooks/memory_inject.py (NUEVO)

INFRAESTRUCTURA
└── Jart-OS/docker-compose.yml (añadir Jart-Core-Memory service en Fase D)
```

---

## Tabla maestra de cambios por fase

| Proyecto | Archivo/Componente | Tipo | Fase | Descripción |
|---------|-------------------|------|------|-------------|
| **Router-Jart** | `src/enrichment/` (nuevo dir) | CREATE | A | Módulo EnrichmentMiddleware completo |
| **Router-Jart** | `src/main.py` | MODIFY | A | Registrar middleware + enrich router |
| **Router-Jart** | `.env` / env vars | MODIFY | A | `ENRICHMENT_MEMORY_URL=http://localhost:8890` |
| **Claude Code** | `~/.claude/hooks/memory_inject.py` | CREATE | A | Hook de inyección para Claude Code |
| **Claude Code** | `~/.claude/settings.json` | MODIFY | A | `disableAllHooks: false` + registrar hook |
| **Jart-Core-Memory** | Repo completo | CREATE | B | Nuevo servicio en `/Users/ruben/Code/jart-core-memory/` |
| **launchd** | `com.jart-core-memory.plist` | CREATE | B | Autoarranque del nuevo servicio |
| **Router-Jart** | `.env` / env vars | MODIFY | B | `ENRICHMENT_MEMORY_URL=http://localhost:8891` |
| **MCP-agent-memory** | `src/unified/server/main.py` | MODIFY | B | Eliminar arranque Backpack API sidecar |
| **launchd** | `com.agent-memory.backpack-api.plist` | DEPRECATE | B | Mover a .deprecated |
| **MCP-agent-memory** | `src/shared/core_memory_client.py` | CREATE | C | Cliente HTTP a Jart-Core-Memory |
| **MCP-agent-memory** | `src/L5_routing/server/main.py` | MODIFY | C | request_context → proxy a /api/context |
| **MCP-agent-memory** | `src/L3_semantic/tools/*.py` | MODIFY | C | Tools → proxy via CoreMemoryClient |
| **cowork_bridge.sh** | Todo | MODIFY | C | URLs :8890 → :8891 |
| **launchd** | `com.agent-memory.lifecycle.plist` | MODIFY | C | URL de notificación a :8891 |
| **launchd** | `com.agent-memory.reembed.plist` | MODIFY | C | URL de re-embedding a :8891 |
| **Cursor** | `~/.cursor/hooks/memory_inject.py` | CREATE | D | Hook de inyección para Cursor |
| **Windsurf** | `~/.codeium/windsurf/hooks/memory_inject.py` | CREATE | D | Hook para Windsurf |
| **Jart-OS** | `docker-compose.yml` | MODIFY | D | Añadir service Jart-Core-Memory |
| **launchd** | `com.agent-memory.backpack-api.plist.deprecated` | DELETE | D | Limpieza final |
| **jart-brain** | Repo completo | CREATE | E | Nuevo servicio en `/Users/ruben/Code/jart-brain/` |
| **launchd** | `com.jart-brain.plist` | CREATE | E | Autoarranque de Jart-BRAIN |
| **Router-Jart** | `src/enrichment/middleware.py` | MODIFY | E | Llamar a JBRAIN :8892 en vez de Core-Memory :8891 directamente |
| **Router-Jart** | `.env` | MODIFY | E | `ENRICHMENT_BRAIN_URL=http://localhost:8892` |
| **MCP-agent-memory** | `src/unified/server/main.py` | MODIFY | E | Registro en JBRAIN al arrancar (recibe JWT) |
| **Jart-Core-Memory** | `src/main.py` | MODIFY | E | Middleware service-to-service (solo acepta jart-brain y router-jart) |
| **NATS** | `nats-server.conf` | CREATE | F | Configuración del broker NATS en :4222 |
| **launchd** | `com.jart-nats.plist` | CREATE | F | Autoarranque del broker NATS |
| **MCP-agent-memory** | `src/unified/identity.py` | CREATE | F | UUID estable por instalación (~/.jart/agent.uuid) |
| **MCP-agent-memory** | `src/unified/nats_client.py` | CREATE | F | Cliente NATS usando credenciales recibidas de JBRAIN |
| **MCP-agent-memory** | `src/unified/server/main.py` | MODIFY | F | Conectar a NATS al arrancar; suscribirse a tópico de control |
| **jart-brain** | `src/governance/nats_manager.py` | CREATE | F | Emisión de credenciales NATS efímeras por agente |
| **jart-brain** | `src/governance/router.py` | MODIFY | F | `/api/register` devuelve credenciales NATS reales |

---

## Fase A — Cambios detallados (Quick Win)

### 1. Router-Jart: nuevo módulo enrichment

```bash
cd /Users/ruben/Code/Jart-OS/TIERS/TIER-02-GATEWAY/10200-router-jart/src

mkdir -p enrichment/core enrichment/adapters/memory enrichment/adapters/extraction enrichment/adapters/injection enrichment/tests

# Crear archivos según PHASE-A-quickwin.md:
# enrichment/core/ports.py
# enrichment/core/models.py
# enrichment/core/service.py
# enrichment/adapters/memory/backpack.py
# enrichment/adapters/extraction/message.py
# enrichment/factory.py
# enrichment/middleware.py
```

### 2. Router-Jart: registrar middleware en main.py

```python
# Añadir en 10200-router-jart/src/main.py (o app.py — verificar el entrypoint real)

from enrichment.middleware import EnrichmentMiddleware
from enrichment.factory import build_enrichment_service
from enrichment.core.models import EnrichmentConfig
from enrichment.routers import router as enrich_router

# Tras crear la app FastAPI:
config = EnrichmentConfig.from_env()
service = build_enrichment_service(config)
app.add_middleware(EnrichmentMiddleware, service=service, config=config)
app.include_router(enrich_router, prefix="/api")
```

### 3. Router-Jart: variables de entorno

```bash
# En el .env de Router-Jart o en el launchd plist del router:
ENRICHMENT_ENABLED=true
ENRICHMENT_MEMORY_URL=http://localhost:8890
ENRICHMENT_TOKEN_BUDGET=2000
ENRICHMENT_MIN_SCORE=0.65
ENRICHMENT_TIMEOUT_MS=500
ENRICHMENT_CACHE_TTL_S=60
```

### 4. Claude Code: hook de inyección

```bash
# Crear el hook:
cat > ~/.claude/hooks/memory_inject.py << 'EOF'
#!/usr/bin/env python3
# (contenido completo en PHASE-A-quickwin.md §A.8)
EOF
chmod +x ~/.claude/hooks/memory_inject.py
```

```bash
# Editar ~/.claude/settings.json:
# Cambiar "disableAllHooks": true → false
# Añadir hook UserPromptSubmit
```

**Validación Fase A**:
```bash
# Test 1: el endpoint responde
curl -s -X POST http://localhost:10200/api/enrich \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "estado del sistema de memoria"}]}' \
  | python3 -m json.tool

# Test 2: el middleware inyecta en el proxy
curl -s -X POST http://localhost:10200/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "...", "messages": [{"role": "user", "content": "prueba de inyección"}]}' \
  | python3 -c "import sys,json; msgs=json.load(sys.stdin)['messages']; print('System:', msgs[0].get('content','')[:80] if msgs[0]['role']=='system' else 'none')"

# Rollback Fase A: desactivar middleware
# ENRICHMENT_ENABLED=false en env + reiniciar Router-Jart
```

---

## Fase B — Cambios detallados (Jart-Core-Memory)

### 1. Crear repositorio

```bash
mkdir -p ~/Code/jart-core-memory/src/jart_core_memory/{routers,services,adapters,models}
mkdir -p ~/Code/jart-core-memory/{tests,deploy}

# Inicializar pyproject.toml:
cat > ~/Code/jart-core-memory/pyproject.toml << 'EOF'
[project]
name = "jart-core-memory"
version = "1.0.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.111",
    "uvicorn[standard]>=0.30",
    "qdrant-client>=1.9",
    "pydantic>=2.7",
    "pydantic-settings>=2.2",
]

[project.optional-dependencies]
dev = ["pytest", "pytest-asyncio", "httpx"]
EOF

# Crear venv dedicado:
python3 -m venv ~/.venv/jart-core-memory
~/.venv/jart-core-memory/bin/pip install -e "~/Code/jart-core-memory[dev]"
```

### 2. Implementar según PHASE-B-memory-core.md

Archivos clave:
- `src/jart_core_memory/main.py` — app FastAPI + lifespan
- `src/jart_core_memory/config.py` — Settings
- `src/jart_core_memory/routers/context.py` — POST /api/context
- `src/jart_core_memory/services/context_service.py` — retrieval paralelo
- `src/jart_core_memory/adapters/qdrant_adapter.py` — migrado del MCP
- `src/jart_core_memory/adapters/embedding_adapter.py` — migrado del MCP

### 3. launchd — instalar nuevo plist

```bash
cp ~/Code/jart-core-memory/deploy/com.jart-core-memory.plist \
   ~/Library/LaunchAgents/com.jart-core-memory.plist

launchctl load ~/Library/LaunchAgents/com.jart-core-memory.plist

# Verificar:
launchctl list | grep jart-core-memory
curl http://localhost:8891/api/health
```

### 4. MCP-agent-memory: eliminar sidecar

```python
# En /Users/ruben/MCP-servers/MCP-agent-memory/src/unified/server/main.py
# ELIMINAR las líneas de arranque del Backpack API HTTP sidecar
# (buscar: start_api_server, backpack, api_server, :8890)
```

### 5. Deprecar Backpack API plist

```bash
launchctl unload ~/Library/LaunchAgents/com.agent-memory.backpack-api.plist
mv ~/Library/LaunchAgents/com.agent-memory.backpack-api.plist \
   ~/Library/LaunchAgents/com.agent-memory.backpack-api.plist.deprecated
```

### 6. Router-Jart: cambiar URL objetivo

```bash
# En el .env de Router-Jart cambiar:
ENRICHMENT_MEMORY_URL=http://localhost:8891

# Reiniciar Router-Jart
```

**Rollback Fase B**:
```bash
# Si hay problemas con jart-core-memory:
ENRICHMENT_MEMORY_URL=http://localhost:8890  # Volver a Backpack
launchctl load ~/Library/LaunchAgents/com.agent-memory.backpack-api.plist.deprecated
mv *.deprecated * (sin .deprecated)
launchctl load ~/Library/LaunchAgents/com.agent-memory.backpack-api.plist
```

---

## Fase C — Cambios detallados (MCP Slim)

### 1. Crear CoreMemoryClient en MCP

```bash
# En /Users/ruben/MCP-servers/MCP-agent-memory/
# Crear src/shared/core_memory_client.py
# (contenido completo en PHASE-C-mcp-slim.md §C.1)
```

### 2. Refactorizar tools MCP

```bash
# Para cada tool que accede a Qdrant directamente:
# grep -r "qdrant\|embedding_model\|search.*L0_L4\|search.*L3_facts" src/

# Reemplazar acceso directo por CoreMemoryClient calls
```

### 3. Refactorizar L5_routing

```python
# src/L5_routing/server/main.py
# request_context() → proxy a CoreMemoryClient.request_context()
# (ver PHASE-C-mcp-slim.md §C.3)
```

### 4. cowork_bridge.sh — actualizar URLs

```bash
# /Users/ruben/MCP-servers/MCP-agent-memory/scripts/cowork_bridge.sh
# Buscar y reemplazar todas las referencias a :8890 por :8891
# Cambiar rutas de endpoint según nueva API:
#   /api/ingest-event → /api/ingest
#   /api/save-conversation → /api/ingest (con event_type: "conversation")
#   /api/verify-memories → /api/search
```

### 5. Actualizar plists de background jobs

```bash
# Abrir y editar (o regenerar) estos plists:
# com.agent-memory.lifecycle.plist — cambiar URLs internas a :8891
# com.agent-memory.reembed.plist — cambiar URLs de re-embedding a :8891

# Recargar:
launchctl unload ~/Library/LaunchAgents/com.agent-memory.lifecycle.plist
launchctl load ~/Library/LaunchAgents/com.agent-memory.lifecycle.plist

launchctl unload ~/Library/LaunchAgents/com.agent-memory.reembed.plist
launchctl load ~/Library/LaunchAgents/com.agent-memory.reembed.plist
```

### 6. Eliminación del Backpack API

```bash
rm ~/Library/LaunchAgents/com.agent-memory.backpack-api.plist.deprecated
# Opcional: mover src/shared/api_server.py a legacy/
```

---

## Fase D — Cambios detallados (Clientes + Observabilidad)

### 1. Hooks en todos los clientes

```bash
# Cursor:
mkdir -p ~/.cursor/hooks
cp ~/.claude/hooks/memory_inject.py ~/.cursor/hooks/memory_inject.py
sed -i 's/agent_id": "claude-code/agent_id": "cursor/' ~/.cursor/hooks/memory_inject.py
# Registrar en Cursor Settings > Hooks

# Windsurf:
mkdir -p ~/.codeium/windsurf/hooks
cp ~/.claude/hooks/memory_inject.py ~/.codeium/windsurf/hooks/memory_inject.py
sed -i 's/agent_id": "claude-code/agent_id": "windsurf/' ~/.codeium/windsurf/hooks/memory_inject.py
# Registrar en Windsurf Settings
```

### 2. Prometheus en Router-Jart

```bash
# Añadir al pyproject.toml de Router-Jart:
# prometheus-client>=0.20

# Exponer metrics endpoint en main.py:
from prometheus_client import make_asgi_app
metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)
```

### 3. Prometheus en Jart-Core-Memory

```bash
# Añadir al pyproject.toml de jart-core-memory:
# prometheus-client>=0.20

# Exponer /metrics en main.py
```

### 4. Docker Compose

```bash
# En /Users/ruben/Code/Jart-OS/docker-compose.yml:
# Añadir servicio Jart-Core-Memory (ver PHASE-D §D.5)
# Eliminar servicio backpack-api si existía
```

---

## Fase E — Cambios detallados (Jart-BRAIN)

### 1. Crear repositorio jart-brain

```bash
mkdir -p /Users/ruben/Code/jart-brain
# Estructura completa en PHASE-E-jbrain.md §E.0
cd /Users/ruben/Code/jart-brain
uv init --python 3.12
uv add fastapi uvicorn pydantic pyjwt python-dotenv httpx structlog
```

### 2. Implementar según PHASE-E-jbrain.md

Módulos en orden de implementación:
1. `src/core/models.py` + `src/core/core_memory_client.py`
2. `src/governance/jwt_service.py` + `src/governance/router.py`
3. `src/attention/engine.py`
4. `src/workspace/state.py`
5. `src/salience/scorer.py`
6. `src/main.py`

### 3. LaunchD — instalar JBRAIN

```bash
cp /Users/ruben/Code/jart-brain/deploy/com.jart-brain.plist \
   ~/Library/LaunchAgents/com.jart-brain.plist

launchctl load ~/Library/LaunchAgents/com.jart-brain.plist
curl http://localhost:8892/api/health
```

### 4. Router-Jart: apuntar a JBRAIN

```bash
# En .env de Router-Jart:
# ANTES:  ENRICHMENT_MEMORY_URL=http://localhost:8891
# DESPUÉS: ENRICHMENT_BRAIN_URL=http://localhost:8892

# En EnrichmentMiddleware: cambiar cliente de CoreMemory a JBRAINClient
```

### 5. MCP-agent-memory: registro al arrancar

```python
# Añadir en src/unified/server/main.py
# Al inicializar: llamar _register_with_brain()
# Guardar SESSION_TOKEN para adjuntar a cada tool call
# (código completo en PHASE-E-jbrain.md §E.9.2)
```

### 6. Jart-Core-Memory: enforcement service-to-service

```python
# Añadir middleware de autenticación en Jart-Core-Memory
# Solo aceptar X-Jart-Service-Id: jart-brain o router-jart
# (código completo en PHASE-E-jbrain.md §E.9.3)
```

**Validación Fase E**:
```bash
# Registro OK
curl -X POST http://localhost:8892/api/register \
  -d '{"agent_id":"test","client_type":"claude-code","version":"2.0"}'
# → token JWT en respuesta

# Core-Memory rechaza directo
curl http://localhost:8891/api/search -X POST -d '{"query":"test",...}'
# → 403 Forbidden

# Context enriquecido desde JBRAIN
curl -X POST http://localhost:8892/api/context \
  -H "X-Jart-Agent-Token: $TOKEN" \
  -d '{"query":"test","agent_id":"test","session_id":"s1","token_budget":1500}'
# → injection_text + facts
```

**Rollback Fase E**:
```bash
# Si JBRAIN falla: todos los servicios tienen modo degradado
# Router-Jart: ENRICHMENT_BRAIN_URL vacía → skip inyección
# MCP Backpack: SESSION_TOKEN=None → tools sin identidad (Fase D)
```

---

## Fase F — Cambios detallados (NATS + Identidad completa)

### 1. Instalar NATS broker

```bash
brew install nats-server
# Configurar /usr/local/etc/nats-server.conf (ver PHASE-F §F.0.2)
launchctl load ~/Library/LaunchAgents/com.jart-nats.plist
curl http://localhost:8222/healthz
```

### 2. UUID estable en MCP Backpack

```bash
# Crear src/unified/identity.py en MCP-agent-memory
# (código en PHASE-F §F.1.1)
# El UUID se genera en ~/.jart/agent.uuid — persiste entre reinicios
```

### 3. JBRAIN: emitir credenciales NATS

```python
# Crear src/governance/nats_manager.py en jart-brain
# Modificar /api/register para devolver nats.user + nats.password
# (código en PHASE-F §F.2.1-F.2.2)
```

### 4. MCP Backpack: cliente NATS

```bash
# Añadir nats-py a MCP-agent-memory:
uv add nats-py

# Crear src/unified/nats_client.py
# Conectar al arrancar si NATS_CREDS disponibles
# (código en PHASE-F §F.3)
```

### 5. Docker Compose — añadir NATS

```yaml
# En /Users/ruben/Code/Jart-OS/docker-compose.yml
services:
  nats:
    image: nats:2.10-alpine
    ports:
      - "4222:4222"
      - "8222:8222"
    command: ["-c", "/etc/nats/nats-server.conf"]
    volumes:
      - ./config/nats-server.conf:/etc/nats/nats-server.conf
```

**Validación Fase F**:
```bash
# UUID estable
python3 -c "from src.unified.identity import get_or_create_agent_id; print(get_or_create_agent_id())"
# Mismo UUID en dos llamadas

# Registro con NATS creds
curl -X POST http://localhost:8892/api/register \
  -d '{"agent_id":"test","client_type":"claude-code","version":"2.0","nats_endpoint_request":true}'
# → incluye "nats": {"endpoint":"nats://localhost:4222","user":"...","password":"..."}

# Publish en NATS
nats pub jart.governance.audit '{"event":"test"}' --user=... --password=...
```

**Rollback Fase F**:
```bash
# NATS cae: todos los servicios siguen funcionando (NATS es opcional para operaciones core)
# Backpack: si connect_nats() falla → modo sin NATS (degradado silencioso)
# launchctl stop com.jart-nats
```

---

## Engram (:3100) — Relación y acción requerida

Engram es el servicio de memoria persistente basado en archivos que corre en Docker en :3100.

**Relación con jart-core-memory**: Engram gestiona memoria en formato de archivos estructurados. Jart-Core-Memory gestiona memoria vectorial en Qdrant. Son complementarios, no competidores.

**Acción requerida en cascada**:
- Verificar que `cowork_bridge.sh` sigue ingiriendo correctamente a Engram SI usa Engram para almacenamiento primario.
- Si Engram ya no se usa como fuente de retrieval → documentar y deprecar su integración explícitamente.
- Si Engram sigue activo: añadir un adaptador `EngramAdapter` en Jart-Core-Memory para poder consultar Engram como fuente adicional en `ContextService.retrieve()`.

---

## Inventario de puertos post-migración

| Puerto | Servicio | Estado |
|--------|---------|--------|
| :10200 | Router-Jart (con EnrichmentMiddleware) | ✅ Activo |
| :10201 | LiteLLM proxy | ✅ Sin cambios |
| :9000  | vLLM / Embedding | ✅ Sin cambios |
| :6333  | Qdrant | ✅ Sin cambios |
| :8892  | Jart-BRAIN (NUEVO) | ✅ Activo desde Fase E |
| :8891  | Jart-Core-Memory (NUEVO) | ✅ Activo desde Fase B |
| :8890  | Backpack API (MCP sidecar) | ❌ Deprecado en Fase B/C |
| :4222  | NATS broker (NUEVO) | ✅ Activo desde Fase F |
| :8222  | NATS monitoring | ✅ Activo desde Fase F |
| :3100  | Engram (Docker) | ⚠️ Revisar relación |

---

## Criterios de rollback

| Condición | Acción de rollback |
|-----------|------------------|
| Jart-Core-Memory no responde en < 1s | `ENRICHMENT_MEMORY_URL=http://localhost:8890` + reinicio router |
| Tools MCP fallan tras Fase C | `git revert` en MCP-agent-memory + reinicio MCP |
| Hooks de IDE bloquean sesión | `"disableAllHooks": true` en settings.json de cada cliente |
| Latencia de enriquecimiento > 600ms | `ENRICHMENT_ENABLED=false` + reinicio router |

---

## Validación end-to-end final

```bash
#!/bin/bash
# migration/validate-full-stack.sh

PASS=0; FAIL=0
check() { local name="$1"; local cmd="$2"; eval "$cmd" &>/dev/null && { echo "✅ $name"; ((PASS++)); } || { echo "❌ $name"; ((FAIL++)); }; }

check "Jart-Core-Memory health"    "curl -sf http://localhost:8891/api/health"
check "Router-Jart health"         "curl -sf http://localhost:10200/health"
check "Enrichment endpoint"        "curl -sf http://localhost:10200/api/enrich/health"
check "Backpack API down"          "! curl -sf --max-time 2 http://localhost:8890/api/health"
check "Memory injection works"     "curl -sf -X POST http://localhost:10200/api/enrich -H 'Content-Type: application/json' -d '{\"messages\":[{\"role\":\"user\",\"content\":\"prueba del sistema jart\"}]}' | python3 -c \"import sys,json; d=json.load(sys.stdin); exit(0 if d.get('was_enriched') else 1)\""
check "Claude Code hook exists"    "test -f ~/.claude/hooks/memory_inject.py"
check "Claude Code hooks enabled"  "python3 -c \"import json; d=json.load(open(os.path.expanduser('~/.claude/settings.json'))); exit(0 if not d.get('disableAllHooks', True) else 1)\""
check "MCP plist loaded"           "launchctl list | grep -q com.agent-memory"
check "Core memory plist loaded"   "launchctl list | grep -q com.jart-core-memory"
check "Jart-BRAIN health"          "curl -sf http://localhost:8892/api/health"
check "JBRAIN register works"      "curl -sf -X POST http://localhost:8892/api/register -H 'Content-Type: application/json' -d '{\"agent_id\":\"validate-01\",\"client_type\":\"claude-code\",\"version\":\"test\"}' | python3 -c 'import sys,json; d=json.load(sys.stdin); exit(0 if \"token\" in d else 1)'"
check "Core-Memory blocks direct"  "curl -sf http://localhost:8891/api/health && curl -sf -X POST http://localhost:8891/api/search -H 'Content-Type: application/json' -d '{\"query\":\"x\",\"collections\":[\"L0_L4_memory\"],\"limit\":1}' && exit 1 || exit 0"
check "NATS broker up"             "curl -sf http://localhost:8222/healthz"
check "Agent UUID exists"          "test -f ~/.jart/agent.uuid"
check "JBRAIN plist loaded"        "launchctl list | grep -q com.jart-brain"
check "NATS plist loaded"          "launchctl list | grep -q com.jart-nats"

echo ""
echo "Resultado: $PASS pasados, $FAIL fallidos"
exit $FAIL
```
