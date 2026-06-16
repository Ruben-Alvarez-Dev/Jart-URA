# Fase F — NATS + Identidad completa

> **Objetivo**: Levantar el broker NATS. Activar identidad completa (UUID estable + JWT por sesión). Backpack gestiona credenciales NATS recibidas de JBRAIN. Todos los servicios validan token en cada request.  
> **Prerrequisitos**: Fase E completa (JBRAIN operativo, tokens JWT emitidos y validados)  
> **Resultado**: Zero-trust by design activo en toda la cadena. NATS como bus de comunicaciones internas. MCP Backpack = única llave de acceso al ecosistema.  
> **Duración estimada**: 4–5 días  
> **ADR de referencia**: ADR-005-mcp-backpack-mandatory-identity-gateway.md

---

## F.0 — Instalar y configurar NATS broker

### F.0.1 — Instalación

```bash
# macOS con Homebrew
brew install nats-server

# Verificar
nats-server --version
```

### F.0.2 — Configuración básica (single-node, sin TLS por ahora)

```conf
# /usr/local/etc/nats-server.conf
port: 4222
http_port: 8222          # monitoring UI

# Autorización básica (sustituir por credentials en producción)
authorization {
  timeout: 1

  users = [
    { user: jart-brain,  password: "CHANGE_ME_BRAIN",  permissions: { publish: ">", subscribe: ">" } },
    { user: router-jart, password: "CHANGE_ME_ROUTER", permissions: { publish: ["jart.memory.>"], subscribe: [] } },
    { user: engram,      password: "CHANGE_ME_ENGRAM",  permissions: { publish: ["jart.memory.ingest"], subscribe: [] } },
    # Los agentes reciben credenciales efímeras desde JBRAIN (Fase F.2)
  ]
}

# Logs
log_file: "/tmp/nats-server.log"
logtime: true
```

### F.0.3 — LaunchD para NATS

```xml
<!-- ~/Library/LaunchAgents/com.jart-nats.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.jart-nats</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/nats-server</string>
    <string>-c</string>
    <string>/usr/local/etc/nats-server.conf</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/nats-server.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/nats-server.error.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.jart-nats.plist
launchctl start com.jart-nats

# Verificar
curl http://localhost:8222/healthz
```

---

## F.1 — UUID estable en MCP Backpack

### F.1.1 — Generación y persistencia de UUID por instalación

```python
# En MCP-agent-memory: src/unified/identity.py
import uuid
import json
from pathlib import Path

UUID_FILE = Path.home() / ".jart" / "agent.uuid"

def get_or_create_agent_id() -> str:
    """UUID estable por instalación. Se genera una vez, persiste entre reinicios."""
    UUID_FILE.parent.mkdir(parents=True, exist_ok=True)
    if UUID_FILE.exists():
        data = json.loads(UUID_FILE.read_text())
        return data["agent_id"]
    agent_id = str(uuid.uuid4())
    UUID_FILE.write_text(json.dumps({"agent_id": agent_id, "created_at": __import__("datetime").datetime.now().isoformat()}))
    return agent_id
```

### F.1.2 — Integrar en arranque del MCP

```python
# En src/unified/server/main.py — al inicializar:
from .identity import get_or_create_agent_id

AGENT_ID = get_or_create_agent_id()
SESSION_TOKEN: str | None = None
NATS_CREDS: dict | None = None

async def _register_with_brain() -> None:
    global SESSION_TOKEN, NATS_CREDS
    try:
        async with httpx.AsyncClient(timeout=5.0) as c:
            r = await c.post("http://localhost:8892/api/register", json={
                "agent_id": AGENT_ID,
                "client_type": CLIENT_TYPE,   # "claude-code" | "cursor" | ...
                "version": VERSION,
                "nats_endpoint_request": True,
            })
            data = r.json()
            SESSION_TOKEN = data["token"]
            NATS_CREDS = data.get("nats")     # {"endpoint": ..., "user": ..., "password": ...}
    except Exception as e:
        # Modo degradado: backpack funciona sin memoria ni NATS
        SESSION_TOKEN = None
        NATS_CREDS = None

async def _deregister_from_brain() -> None:
    if SESSION_TOKEN:
        with httpx.Client(timeout=2.0) as c:
            c.post(f"http://localhost:8892/api/deregister?agent_id={AGENT_ID}")
```

---

## F.2 — JBRAIN emite credenciales NATS al registrar agentes

### F.2.1 — Credenciales efímeras por sesión

JBRAIN crea un usuario NATS efímero por cada agente registrado. En producción esto se haría con NATS NKeys/JWT nativo. En Fase F usamos el API de autorización de NATS:

```python
# src/governance/nats_manager.py
import secrets
import httpx

NATS_ADMIN_URL = "http://localhost:8222"   # monitoring port (extendido con admin API)
NATS_ENDPOINT = "nats://localhost:4222"

def generate_agent_credentials(agent_id: str) -> dict:
    """Genera credenciales efímeras para un agente. Fase F: contraseña aleatoria."""
    password = secrets.token_urlsafe(24)
    # En Fase F inicial: almacenar en memoria; en producción usar NATS NKeys
    _active_creds[agent_id] = password
    return {
        "endpoint": NATS_ENDPOINT,
        "user": f"agent.{agent_id[:8]}",
        "password": password,
        "topics": {
            "publish": [
                f"jart.agent.{agent_id}.events",
                "jart.memory.ingest",
                "jart.governance.audit",
            ],
            "subscribe": [
                f"jart.agent.{agent_id}.control",
                f"jart.memory.context.>",
            ],
        },
    }

_active_creds: dict[str, str] = {}

def revoke_agent_credentials(agent_id: str) -> None:
    _active_creds.pop(agent_id, None)
```

### F.2.2 — Integrar en el endpoint `/api/register`

```python
# En src/governance/router.py — modificar el endpoint register:
from .nats_manager import generate_agent_credentials, revoke_agent_credentials

@router.post("/register")
async def register(req: RegisterRequest):
    token_data = mint_token(req.agent_id, req.client_type, req.version)
    session = AgentSession(...)
    await workspace.register(session)

    response = {
        "agent_id": req.agent_id,
        "token": token_data["token"],
        "expires_at": token_data["expires_at"],
        "capabilities": token_data["capabilities"],
    }

    if req.nats_endpoint_request:
        nats_creds = generate_agent_credentials(req.agent_id)
        response["nats"] = nats_creds   # ahora incluye user/password reales

    return response

@router.post("/deregister")
async def deregister(agent_id: str):
    await workspace.deregister(agent_id)
    revoke_agent_credentials(agent_id)   # revocar credenciales NATS
    return {"status": "ok"}
```

---

## F.3 — MCP Backpack: cliente NATS

```python
# En MCP-agent-memory: src/unified/nats_client.py
import nats  # pip install nats-py

_nc = None  # connexión NATS activa

async def connect_nats(creds: dict) -> None:
    global _nc
    _nc = await nats.connect(
        servers=[creds["endpoint"]],
        user=creds["user"],
        password=creds["password"],
    )

async def publish_event(agent_id: str, event_type: str, payload: dict) -> None:
    if not _nc:
        return  # modo degradado silencioso
    topic = f"jart.agent.{agent_id}.events"
    await _nc.publish(topic, __import__("json").dumps({
        "event_type": event_type,
        "agent_id": agent_id,
        **payload,
    }).encode())

async def subscribe_control(agent_id: str, handler) -> None:
    if not _nc:
        return
    topic = f"jart.agent.{agent_id}.control"
    await _nc.subscribe(topic, cb=handler)

async def disconnect_nats() -> None:
    global _nc
    if _nc:
        await _nc.drain()
        _nc = None
```

### Integración en el arranque:

```python
# src/unified/server/main.py — después de _register_with_brain():
if NATS_CREDS:
    await connect_nats(NATS_CREDS)
    await subscribe_control(AGENT_ID, _handle_control_message)

async def _handle_control_message(msg):
    """Maneja comandos de gobernanza desde JBRAIN (ej: forzar consolidación)."""
    data = __import__("json").loads(msg.data.decode())
    if data.get("command") == "consolidate":
        await trigger_consolidation(AGENT_ID)
```

---

## F.4 — Enforcement completo en todos los servicios

Con Fase F, el enforcement pasa de "parcial" a "total":

### F.4.1 — Router-Jart: sin token → modo anonymous estricto

```python
# EnrichmentMiddleware — lógica final Fase F
async def enrich(request: Request) -> dict | None:
    agent_token = request.headers.get("X-Jart-Agent-Token")
    if not agent_token:
        # Anonymous: forward sin inyección, sin error
        return None

    # Delegar toda la lógica a JBRAIN
    try:
        result = await jbrain_client.context(
            query=extract_query(request),
            agent_id=request.headers.get("X-Jart-Agent-Id", "anonymous"),
            token=agent_token,
            timeout_ms=450,
        )
        return result
    except (TimeoutError, JBRAINUnavailable):
        return None  # degradado silencioso
```

### F.4.2 — Jart-Core-Memory: enforcement service-to-service activo

```python
# Middleware de autenticación en Jart-Core-Memory
ALLOWED_CALLERS = {"jart-brain", "router-jart"}
SERVICE_SECRET = os.environ.get("JART_SERVICE_SECRET", "change-me")

@app.middleware("http")
async def service_auth_middleware(request: Request, call_next):
    if request.url.path == "/api/health":
        return await call_next(request)
    service_id = request.headers.get("X-Jart-Service-Id")
    service_key = request.headers.get("X-Jart-Service-Key")
    if service_id not in ALLOWED_CALLERS or service_key != SERVICE_SECRET:
        return JSONResponse({"error": "forbidden"}, status_code=403)
    return await call_next(request)
```

Env vars en Jart-Core-Memory:
```bash
JART_SERVICE_SECRET=shared-service-key-min-32-chars
```

Env vars en JBRAIN y Router-Jart (para llamar a Core-Memory):
```bash
JART_SERVICE_ID=jart-brain      # o router-jart
JART_SERVICE_SECRET=shared-service-key-min-32-chars
```

---

## F.5 — Tópicos NATS: definición completa

| Tópico | Dirección | Publicado por | Suscrito por | Propósito |
|--------|-----------|--------------|-------------|-----------|
| `jart.agent.{id}.events` | agent → ecosystem | Backpack | JBRAIN, Engram | Eventos del agente (tool calls, resultados) |
| `jart.agent.{id}.control` | ecosystem → agent | JBRAIN | Backpack | Comandos de gobernanza (consolidate, refresh-token) |
| `jart.memory.ingest` | any → core | Backpack, Engram | JBRAIN | Cola de ingesta asíncrona |
| `jart.memory.context.{session_id}` | brain → agents | JBRAIN | Backpack | Broadcast de contexto compartido |
| `jart.governance.audit` | any → audit | Backpack | JBRAIN (audit log) | Auditoría de acciones |

---

## F.6 — Verificación de la Fase F

```bash
# 1. NATS broker activo
curl http://localhost:8222/healthz
# → {"status":"ok"}

# 2. Registro con NATS credentials
RESP=$(curl -s -X POST http://localhost:8892/api/register \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"test-001","client_type":"claude-code","version":"2.1.0","nats_endpoint_request":true}')
echo $RESP | python3 -m json.tool
# → Incluye "nats": {"endpoint":"nats://localhost:4222","user":"agent.test-001",...}

# 3. UUID estable (simular dos arranques)
python3 -c "from src.unified.identity import get_or_create_agent_id; print(get_or_create_agent_id())"
python3 -c "from src.unified.identity import get_or_create_agent_id; print(get_or_create_agent_id())"
# → Mismo UUID en ambas llamadas

# 4. Publicar en tópico NATS (usando nats CLI)
brew install nats-io/nats-tools/nats
nats pub jart.governance.audit '{"event":"test","agent_id":"test-001"}' \
  --user=agent.test-0 --password=<creds del paso 2>

# 5. Core-Memory rechaza llamadas sin cabecera de servicio
curl http://localhost:8891/api/search -X POST \
  -H "Content-Type: application/json" \
  -d '{"query":"test","collections":["L0_L4_memory"],"limit":5}'
# → {"error":"forbidden"}

# 6. Core-Memory acepta llamadas de JBRAIN (simular)
curl http://localhost:8891/api/search -X POST \
  -H "Content-Type: application/json" \
  -H "X-Jart-Service-Id: jart-brain" \
  -H "X-Jart-Service-Key: shared-service-key-min-32-chars" \
  -d '{"query":"test","collections":["L0_L4_memory"],"limit":5}'
# → Responde normalmente
```

**Criterio de "Done" para Fase F**: Todos los checks pasan. La MCP Backpack arranca, registra UUID estable, recibe token JWT y credenciales NATS, conecta al broker. Jart-Core-Memory rechaza cualquier llamada sin cabecera de servicio válida. El ecosistema opera en modo zero-trust completo.

---

## F.7 — Estado final del ecosistema (post Fase F)

```
IDE / Claude Code / Cursor / Windsurf
  └── MCP Backpack (sidecar)
        ├── agent.uuid → ~/.jart/agent.uuid (estable)
        ├── JWT token  ← Jart-BRAIN /api/register
        ├── NATS creds ← Jart-BRAIN /api/register
        └── MCP tools (memory_add, memory_search, memory_context)
              ↓ X-Jart-Agent-Token en cada llamada
Jart-BRAIN :8892
  ├── Governance Plane (JWT, registro, validación)
  ├── Attention Engine + Memory Router
  ├── Salience Scorer + Global Workspace
  └── Consolidation Orchestrator
        ↓ X-Jart-Service-Id + X-Jart-Service-Key
Jart-Core-Memory :8891
  ├── Qdrant (storage)
  ├── Embeddings :9000
  └── Pipeline L0→L4 (ejecución bajo órdenes de JBRAIN)

NATS broker :4222
  └── Bus interno: eventos, control, audit, context broadcast

Engram :3100
  └── Buffer de ingesta asíncrona → jart.memory.ingest

Router-Jart :10200
  └── EnrichmentMiddleware → JBRAIN /api/context
```
