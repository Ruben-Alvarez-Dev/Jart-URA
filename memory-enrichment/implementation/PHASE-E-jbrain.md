# Fase E — Jart-BRAIN: capa cognitiva y governance plane

> **Objetivo**: Introducir Jart-BRAIN (:8892) como servicio nuevo. Separar lógica cognitiva de Jart-Core-Memory. Implementar el governance plane que emite tokens JWT para las backpacks.  
> **Prerrequisitos**: Fase D completa (Router-Jart + Core-Memory + MCP slim + hooks activados)  
> **Resultado**: La lógica cognitiva vive en JBRAIN; la infraestructura (Qdrant, embeddings) queda en Core-Memory. Tokens JWT emitidos y validados en cada request.  
> **Duración estimada**: 5–7 días  
> **ADR de referencia**: ADR-006-jart-brain-cognitive-layer.md

---

## E.0 — Crear el repositorio jart-brain

```bash
mkdir -p /Users/ruben/Code/jart-brain
cd /Users/ruben/Code/jart-brain

# Estructura de directorios
mkdir -p src/{attention,workspace,router,salience,consolidation,governance,core}
mkdir -p tests/{unit,integration}
touch src/__init__.py

# Inicializar uv
uv init --python 3.12
uv add fastapi uvicorn pydantic pyjwt python-dotenv httpx structlog prometheus-client
uv add --dev pytest pytest-asyncio httpx respx
```

Estructura final:
```
jart-brain/
├── src/
│   ├── attention/        # Attention Engine
│   ├── workspace/        # Global Workspace (estado compartido)
│   ├── router/           # Memory Router
│   ├── salience/         # Salience Scorer
│   ├── consolidation/    # Consolidation Orchestrator
│   ├── governance/       # Governance Plane (JWT, registro, validación)
│   ├── core/             # Modelos compartidos, cliente Core-Memory
│   └── main.py           # FastAPI app
├── tests/
├── pyproject.toml
├── .env
└── .env.example
```

---

## E.1 — Modelos compartidos (`src/core/`)

### E.1.1 — Modelos Pydantic

```python
# src/core/models.py
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime

class ContextSignal(BaseModel):
    query: str
    agent_id: str
    session_id: str
    token_budget: int = 1500
    client_type: Optional[str] = None

class MemoryFact(BaseModel):
    id: str
    content: str
    score: float
    collection: str
    created_at: datetime
    agent_id: Optional[str] = None

class AttentionPlan(BaseModel):
    collections: list[str]
    weights: dict[str, float]
    budget: int
    min_score: float = 0.65

class ContextResult(BaseModel):
    injection_text: str
    facts: list[MemoryFact]
    agent_id: str
    session_id: str
    latency_ms: float

class AgentSession(BaseModel):
    agent_id: str
    client_type: str
    version: str
    registered_at: datetime
    last_seen: datetime
    capabilities: list[str] = []
    token_budget: int = 1500
    recent_topics: list[str] = []
```

### E.1.2 — Cliente HTTP hacia Jart-Core-Memory

```python
# src/core/core_memory_client.py
import httpx
from typing import Optional
from .models import MemoryFact, AttentionPlan

CORE_MEMORY_BASE = "http://localhost:8891"

async def search_memory(
    query: str,
    plan: AttentionPlan,
    session_id: str,
) -> list[MemoryFact]:
    """Llama a Jart-Core-Memory /api/search con el plan de atención."""
    async with httpx.AsyncClient(timeout=3.0) as client:
        r = await client.post(f"{CORE_MEMORY_BASE}/api/search", json={
            "query": query,
            "collections": plan.collections,
            "limit": plan.budget // 100,
            "min_score": plan.min_score,
            "session_id": session_id,
        })
        r.raise_for_status()
        return [MemoryFact(**f) for f in r.json()["results"]]

async def trigger_consolidation(agent_id: str, dry_run: bool = False) -> dict:
    """Ordena a Core-Memory ejecutar un ciclo de consolidación."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(f"{CORE_MEMORY_BASE}/api/consolidate", json={
            "agent_id": agent_id,
            "dry_run": dry_run,
        })
        r.raise_for_status()
        return r.json()
```

---

## E.2 — Attention Engine (`src/attention/`)

```python
# src/attention/engine.py
import re
from ..core.models import ContextSignal, AttentionPlan, AgentSession

# Señales de tipo técnico (código, arquitectura)
_CODE_SIGNALS = re.compile(
    r'\b(def |class |import |function|async|await|error|exception|stack|trace|'
    r'module|package|api|endpoint|database|query|schema|migration)\b',
    re.IGNORECASE
)

# Señales conversacionales / contextuales
_CONV_SIGNALS = re.compile(
    r'\b(ayer|antes|dijiste|recuerdas|mencionaste|hablamos|la semana|'
    r'yesterday|you said|remember|we discussed|last week)\b',
    re.IGNORECASE
)

def _route_collections(signal: ContextSignal) -> list[str]:
    query = signal.query
    if _CODE_SIGNALS.search(query):
        return ["L3_facts", "L0_L4_memory"]
    elif _CONV_SIGNALS.search(query):
        return ["L2_conversations", "L0_L4_memory"]
    else:
        return ["L0_L4_memory", "L3_facts"]

def _compute_weights(signal: ContextSignal, profile: AgentSession) -> dict[str, float]:
    base = {"L0_L4_memory": 1.0, "L3_facts": 0.9, "L2_conversations": 0.8}
    # Boostar colecciones relevantes por historial reciente del agente
    for topic in profile.recent_topics[-3:]:
        if topic in signal.query.lower():
            for k in base:
                base[k] *= 1.1
            break
    return base

async def attend(signal: ContextSignal, profile: AgentSession) -> AttentionPlan:
    collections = _route_collections(signal)
    weights = _compute_weights(signal, profile)
    return AttentionPlan(
        collections=collections,
        weights=weights,
        budget=profile.token_budget,
        min_score=0.62,
    )
```

---

## E.3 — Global Workspace (`src/workspace/`)

```python
# src/workspace/state.py
import asyncio
from datetime import datetime
from typing import Optional
from ..core.models import AgentSession, MemoryFact

class GlobalWorkspace:
    """Estado compartido entre todos los agentes activos. In-memory por ahora."""

    def __init__(self):
        self._lock = asyncio.Lock()
        self.active_agents: dict[str, AgentSession] = {}
        self.broadcast_context: list[MemoryFact] = []
        self.session_topic: str = ""
        self.last_consolidated: Optional[datetime] = None

    async def register(self, session: AgentSession) -> None:
        async with self._lock:
            self.active_agents[session.agent_id] = session

    async def deregister(self, agent_id: str) -> None:
        async with self._lock:
            self.active_agents.pop(agent_id, None)

    async def broadcast(self, facts: list[MemoryFact], threshold: float = 0.80) -> None:
        """Añade hechos de alta puntuación al workspace compartido."""
        async with self._lock:
            high_score = [f for f in facts if f.score >= threshold]
            existing_ids = {f.id for f in self.broadcast_context}
            for f in high_score:
                if f.id not in existing_ids:
                    self.broadcast_context.append(f)
            # Mantener máximo 20 hechos en el workspace
            self.broadcast_context = sorted(
                self.broadcast_context, key=lambda f: f.score, reverse=True
            )[:20]

    async def get_broadcast(self) -> list[MemoryFact]:
        async with self._lock:
            return list(self.broadcast_context)

# Singleton compartido por todos los módulos
workspace = GlobalWorkspace()
```

---

## E.4 — Salience Scorer (`src/salience/`)

```python
# src/salience/scorer.py
import math
from datetime import datetime, timezone
from ..core.models import MemoryFact

def _time_decay(created_at: datetime, half_life_days: float = 30.0) -> float:
    """Exponential decay: 1.0 si es de hoy, ~0.5 a los 30 días."""
    now = datetime.now(timezone.utc)
    age_days = (now - created_at.replace(tzinfo=timezone.utc)).total_seconds() / 86400
    return math.exp(-0.693 * age_days / half_life_days)

def score(
    fact: MemoryFact,
    requesting_agent: str,
    in_broadcast: bool = False,
) -> float:
    s = fact.score  # score vectorial base de Qdrant

    # Decay temporal
    s *= _time_decay(fact.created_at)

    # Boost si el agente solicitante creó este hecho
    if fact.agent_id == requesting_agent:
        s *= 1.15

    # Boost si ya está en el workspace broadcast
    if in_broadcast:
        s *= 1.20

    return min(s, 1.0)  # nunca superar 1.0

def rerank(
    facts: list[MemoryFact],
    agent_id: str,
    broadcast_ids: set[str],
) -> list[MemoryFact]:
    scored = [(f, score(f, agent_id, f.id in broadcast_ids)) for f in facts]
    scored.sort(key=lambda x: x[1], reverse=True)
    for f, s in scored:
        f.score = s
    return [f for f, _ in scored]
```

---

## E.5 — Governance Plane (`src/governance/`)

### E.5.1 — JWT

```python
# src/governance/jwt_service.py
import jwt
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

SECRET_KEY = os.environ.get("JBRAIN_JWT_SECRET", "change-me-in-production")
ALGORITHM = "HS256"
SESSION_TTL_HOURS = int(os.environ.get("JBRAIN_SESSION_TTL_H", "8"))

# Capabilities por tipo de cliente
_DEFAULT_CAPABILITIES = {
    "claude-code":  ["memory:read", "memory:write", "memory:consolidate", "nats:subscribe", "nats:publish"],
    "cursor":       ["memory:read", "memory:write", "nats:subscribe"],
    "windsurf":     ["memory:read", "memory:write", "nats:subscribe"],
    "cowork":       ["memory:read", "memory:write", "nats:subscribe", "nats:publish"],
    "vscode":       ["memory:read"],
    "anonymous":    [],
}

def mint_token(agent_id: str, client_type: str, version: str = "unknown") -> dict:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(hours=SESSION_TTL_HOURS)
    caps = _DEFAULT_CAPABILITIES.get(client_type, ["memory:read"])

    payload = {
        "iss": "jart-brain",
        "sub": agent_id,
        "jti": str(uuid.uuid4()),
        "client_type": client_type,
        "version": version,
        "capabilities": caps,
        "rate_limits": {
            "context_requests_per_min": 60,
            "ingest_per_min": 120,
        },
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
    return {"token": token, "expires_at": exp.isoformat(), "capabilities": caps}

def validate_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
```

### E.5.2 — Router de gobernanza

```python
# src/governance/router.py
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
from .jwt_service import mint_token, validate_token
from ..workspace.state import workspace
from ..core.models import AgentSession

router = APIRouter(prefix="/api", tags=["governance"])

class RegisterRequest(BaseModel):
    agent_id: str
    client_type: str
    version: str = "unknown"
    nats_endpoint_request: bool = False

@router.post("/register")
async def register(req: RegisterRequest):
    token_data = mint_token(req.agent_id, req.client_type, req.version)
    session = AgentSession(
        agent_id=req.agent_id,
        client_type=req.client_type,
        version=req.version,
        registered_at=datetime.now(timezone.utc),
        last_seen=datetime.now(timezone.utc),
        capabilities=token_data["capabilities"],
    )
    await workspace.register(session)

    response = {
        "agent_id": req.agent_id,
        "token": token_data["token"],
        "expires_at": token_data["expires_at"],
        "capabilities": token_data["capabilities"],
    }

    # En Fase F se añadirán NATS credentials aquí
    if req.nats_endpoint_request:
        response["nats"] = {
            "endpoint": "nats://localhost:4222",
            "credentials": None,  # Fase F
        }

    return response

@router.post("/deregister")
async def deregister(agent_id: str):
    await workspace.deregister(agent_id)
    return {"status": "ok"}

@router.get("/validate")
async def validate(x_jart_agent_token: Optional[str] = Header(None)):
    if not x_jart_agent_token:
        raise HTTPException(status_code=401, detail="Missing token")
    payload = validate_token(x_jart_agent_token)
    if not payload:
        raise HTTPException(status_code=403, detail="Invalid or expired token")
    return {"valid": True, "payload": payload}

@router.get("/agents")
async def list_agents():
    return {"agents": list(workspace.active_agents.values())}

@router.get("/workspace")
async def get_workspace():
    broadcast = await workspace.get_broadcast()
    return {
        "active_agents": len(workspace.active_agents),
        "broadcast_facts": len(broadcast),
        "session_topic": workspace.session_topic,
        "last_consolidated": workspace.last_consolidated,
    }
```

---

## E.6 — API cognitiva y main.py

```python
# src/main.py
import os
import time
from fastapi import FastAPI, HTTPException, Header
from typing import Optional
from .core.models import ContextSignal, ContextResult
from .core.core_memory_client import search_memory, trigger_consolidation
from .attention.engine import attend
from .workspace.state import workspace
from .salience.scorer import rerank
from .governance.router import router as governance_router
from .governance.jwt_service import validate_token

app = FastAPI(title="Jart-BRAIN", version="0.1.0")
app.include_router(governance_router)

def _require_token(token: Optional[str]) -> dict:
    if not token:
        raise HTTPException(status_code=403, detail="X-Jart-Agent-Token requerido")
    payload = validate_token(token)
    if not payload:
        raise HTTPException(status_code=403, detail="Token inválido o expirado")
    return payload

@app.post("/api/context", response_model=ContextResult)
async def get_context(
    signal: ContextSignal,
    x_jart_agent_token: Optional[str] = Header(None),
):
    t0 = time.monotonic()
    payload = _require_token(x_jart_agent_token)

    profile = workspace.active_agents.get(signal.agent_id)
    if not profile:
        raise HTTPException(status_code=403, detail="Agente no registrado")

    # Atención → búsqueda → salience
    plan = await attend(signal, profile)
    facts = await search_memory(signal.query, plan, signal.session_id)
    broadcast = await workspace.get_broadcast()
    broadcast_ids = {f.id for f in broadcast}
    ranked = rerank(facts + broadcast, signal.agent_id, broadcast_ids)[:10]

    # Broadcast hechos con alta puntuación al workspace compartido
    await workspace.broadcast(ranked)

    # Construir texto de inyección
    if ranked:
        lines = [f"[JART-MEMORY: {f.collection}] {f.content}" for f in ranked[:5]]
        injection_text = "\n".join(lines)
    else:
        injection_text = ""

    return ContextResult(
        injection_text=injection_text,
        facts=ranked,
        agent_id=signal.agent_id,
        session_id=signal.session_id,
        latency_ms=(time.monotonic() - t0) * 1000,
    )

@app.post("/api/consolidate")
async def consolidate(
    agent_id: str,
    dry_run: bool = False,
    x_jart_agent_token: Optional[str] = Header(None),
):
    _require_token(x_jart_agent_token)
    result = await trigger_consolidation(agent_id, dry_run)
    workspace.last_consolidated = __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    )
    return result

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "service": "jart-brain",
        "active_agents": len(workspace.active_agents),
        "broadcast_facts": len(await workspace.get_broadcast()),
    }
```

---

## E.7 — Variables de entorno

```bash
# .env.example
JBRAIN_JWT_SECRET=your-secret-key-min-32-chars
JBRAIN_SESSION_TTL_H=8
JBRAIN_PORT=8892
JBRAIN_HOST=0.0.0.0
CORE_MEMORY_URL=http://localhost:8891
LOG_LEVEL=INFO
```

---

## E.8 — LaunchD service

```xml
<!-- ~/Library/LaunchAgents/com.jart-brain.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.jart-brain</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/ruben/Code/jart-brain/.venv/bin/uvicorn</string>
    <string>src.main:app</string>
    <string>--host</string><string>0.0.0.0</string>
    <string>--port</string><string>8892</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/ruben/Code/jart-brain</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>JBRAIN_JWT_SECRET</key>
    <string>CHANGE_ME_MIN_32_CHARS</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/jart-brain.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/jart-brain.error.log</string>
</dict>
</plist>
```

```bash
# Cargar el servicio
launchctl load ~/Library/LaunchAgents/com.jart-brain.plist
launchctl start com.jart-brain
```

---

## E.9 — Cambios en cascada a otros servicios

### E.9.1 — Router-Jart: apuntar a JBRAIN en vez de Core-Memory directamente

```python
# En EnrichmentMiddleware (src/enrichment/middleware.py)
# ANTES (Fase D):
result = await core_memory.search(query, session_id)

# DESPUÉS (Fase E):
result = await jbrain.context(signal, token=agent_token)
# Si JBRAIN no disponible → modo degradado (no lanzar error)
```

Env vars Router-Jart:
```bash
# ANTES
ENRICHMENT_MEMORY_URL=http://localhost:8891
# DESPUÉS (Fase E)
ENRICHMENT_BRAIN_URL=http://localhost:8892
```

### E.9.2 — MCP Backpack: añadir registro en JBRAIN al arrancar

```python
# En MCP-agent-memory src/unified/server/main.py
# Al inicializar el servidor:

async def _register_with_brain():
    try:
        async with httpx.AsyncClient(timeout=3.0) as c:
            r = await c.post("http://localhost:8892/api/register", json={
                "agent_id": AGENT_ID,
                "client_type": CLIENT_TYPE,
                "version": VERSION,
                "nats_endpoint_request": False,  # True en Fase F
            })
            data = r.json()
            SESSION_TOKEN = data["token"]
    except Exception:
        SESSION_TOKEN = None  # modo degradado
```

### E.9.3 — Jart-Core-Memory: añadir validación service-to-service

```python
# En Jart-Core-Memory: solo aceptar llamadas con cabecera X-Jart-Service-Key
# (token compartido, no JWT de agente)
ALLOWED_SERVICES = {"jart-brain", "router-jart"}

@app.middleware("http")
async def service_auth(request, call_next):
    service = request.headers.get("X-Jart-Service-Id")
    if service not in ALLOWED_SERVICES:
        return JSONResponse({"error": "forbidden"}, status_code=403)
    return await call_next(request)
```

---

## E.10 — Verificación de la Fase E

```bash
# 1. JBRAIN arranca y responde
curl http://localhost:8892/api/health
# → {"status":"ok","service":"jart-brain","active_agents":0,...}

# 2. Registro de backpack
curl -X POST http://localhost:8892/api/register \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"test-001","client_type":"claude-code","version":"2.1.0"}'
# → {"agent_id":"test-001","token":"eyJ...","expires_at":"...","capabilities":[...]}

# 3. Validación de token
TOKEN=<token del paso anterior>
curl http://localhost:8892/api/validate \
  -H "X-Jart-Agent-Token: $TOKEN"
# → {"valid":true,"payload":{...}}

# 4. Context con token
curl -X POST http://localhost:8892/api/context \
  -H "Content-Type: application/json" \
  -H "X-Jart-Agent-Token: $TOKEN" \
  -d '{"query":"arquitectura hexagonal","agent_id":"test-001","session_id":"s-001","token_budget":1500}'
# → {"injection_text":"...","facts":[...],"latency_ms":...}

# 5. Sin token → 403
curl -X POST http://localhost:8892/api/context \
  -H "Content-Type: application/json" \
  -d '{"query":"test","agent_id":"test-001","session_id":"s-001","token_budget":500}'
# → {"detail":"X-Jart-Agent-Token requerido"}

# 6. Workspace compartido
curl http://localhost:8892/api/workspace
# → {"active_agents":1,"broadcast_facts":0,...}
```

**Criterio de "Done" para Fase E**: Todos los checks anteriores pasan. Router-Jart llama a JBRAIN en lugar de Core-Memory directamente. La MCP Backpack recibe un token JWT al arrancar. Core-Memory solo responde a llamadas con `X-Jart-Service-Id` de jart-brain o router-jart.
