# ADR-005 — MCP Backpack como gateway de identidad obligatorio

> Estado: PROPUESTO  
> Fecha: 2026-06-08  
> Relacionado: ADR-002, ADR-003, ADR-006  
> Impacto en: MCP-agent-memory, Jart-BRAIN, Router-Jart, Jart-Core-Memory, Engram, NATS

---

## Contexto

En el diseño anterior, la MCP Backpack (MCP-agent-memory adelgazado) era una "façade de memoria" — una capa conveniente pero técnicamente opcional. Los servicios internos del ecosistema (Jart-Core-Memory, Router-Jart) podían en principio recibir llamadas de cualquier origen.

Con la incorporación de Jart-BRAIN (ADR-006), un bus NATS de comunicaciones internas, y la necesidad de gobernanza por agente (rate limiting, capabilities, auditoría), surge un principio de diseño más fuerte:

**La mochila no es cómoda — es la única llave de acceso al ecosistema Jart-OS.**

El patrón de referencia: los carritos del supermercado Mercadona. La rueda se traba automáticamente al salir del perímetro. No es una política configurable — es un mecanismo físico por diseño.

---

## Decisión

El MCP Backpack (instancia del MCP-agent-memory slim corriendo junto a cada agente/IDE) es el **único punto de entrada contractual al ecosistema Jart-OS** para cualquier agente. Sin backpack activo con token válido:

- Ningún servicio interno sirve contexto de memoria
- Ningún agente puede publicar en el bus NATS
- El enriquecimiento de Router-Jart opera en modo `anonymous` (sin inyección de memoria)
- Jart-BRAIN rechaza peticiones sin `X-Jart-Agent-Token`

El rechazo es **automático y sin configuración** — no es una política que alguien puede desactivar, es la arquitectura.

---

## Responsabilidades de la Mochila

La backpack pasa de ser "façade de memoria" a **sidecar de agente** con cuatro responsabilidades canónicas:

### 1. Identidad

```
Al arrancar:
  → genera o recupera UUID estable por instalación de cliente
  → registra {agent_id, client_type, version} en Jart-BRAIN
  → recibe session_token firmado (TTL: duración de sesión)
```

El `agent_id` es estable entre reinicios. El `session_token` es efímero (por sesión). Ambos viajan en cada llamada a servicios internos.

Cabeceras emitidas por la backpack:
```
X-Jart-Agent-Id: {uuid}          # identidad estable
X-Jart-Agent-Token: {jwt}        # token de sesión
X-Jart-Client-Type: claude-code  # cursor | windsurf | cowork | vscode
X-Jart-Session-Id: {uuid}        # sesión actual
```

### 2. Credenciales y gobernanza

El token emitido por JBRAIN incluye el `capabilities[]` del agente:

```json
{
  "agent_id": "...",
  "client_type": "claude-code",
  "capabilities": [
    "memory:read",
    "memory:write",
    "memory:consolidate",
    "nats:subscribe",
    "nats:publish"
  ],
  "rate_limits": {
    "context_requests_per_min": 60,
    "ingest_per_min": 120
  },
  "expires_at": "..."
}
```

Las capabilities determinan qué puede hacer el agente. Un agente `anonymous` (sin backpack) tiene `capabilities: []`.

### 3. Bus NATS + comunicaciones internas

La backpack es el **único punto de acceso al bus NATS** para el agente:

```
Agente → MCP tool → Backpack → NATS publish/subscribe
```

Las credenciales NATS (usuario, contraseña, TLS cert) viven en la backpack. Un proceso externo que no pase por la backpack no tiene credenciales NATS y no puede suscribirse ni publicar. El "trancazo" es físico: sin credenciales = sin acceso.

Tópicos NATS que gestiona la backpack:
```
jart.agent.{agent_id}.events      # eventos del agente → ecosistema
jart.agent.{agent_id}.control     # comandos de gobernanza → agente
jart.memory.ingest                # ingesta de memoria (pub)
jart.memory.context.{session_id}  # contexto broadcast (sub)
jart.governance.audit             # auditoría (pub, one-way)
```

### 4. Memory tools (como estaba)

Los MCP tools (`memory_add`, `memory_search`, `memory_context`) siguen existiendo con la misma interfaz, pero ahora cada llamada lleva el token de identidad automáticamente. El agente no hace nada distinto — la backpack añade el token de forma transparente.

---

## Enforcement en cada servicio

| Servicio | Mecanismo de rechazo | Respuesta sin token |
|----------|---------------------|---------------------|
| Jart-BRAIN | Valida `X-Jart-Agent-Token` en cada request | `403 Forbidden` |
| Jart-Core-Memory | Solo acepta llamadas de JBRAIN o Router (service-to-service) | `403 Forbidden` |
| Router-Jart (enrich) | Sin agent_id → modo `anonymous`, sin inyección de memoria | Request pasa pelada |
| NATS bus | Sin credenciales de backpack → sin acceso al broker | Conexión rechazada |
| Engram | Requiere `agent_id` válido para atribuir eventos | Evento descartado |

**Regla de implementación**: ningún servicio interno implementa su propia lógica de access control. Solo verifican que el token viene de JBRAIN (firma JWT con clave compartida). La lógica de qué puede hacer cada agente vive exclusivamente en JBRAIN.

---

## Modelo de arranque del sidecar

```
1. IDE arranca → carga MCP Backpack (stdio)
2. Backpack genera/recupera UUID desde ~/.jart/agent.uuid
3. Backpack llama POST http://localhost:8892/api/register
   Body: {agent_id, client_type, version, nats_endpoint_request: true}
4. JBRAIN valida, minta JWT + emite credenciales NATS
5. Backpack configura cliente NATS interno con las credenciales recibidas
6. Backpack está operativa → tools MCP disponibles para el IDE
7. Al cerrar sesión: backpack llama POST /api/deregister (best-effort)
```

Si JBRAIN no está disponible al arrancar:
- La backpack opera en **modo degradado**: tools MCP responden con datos vacíos
- No hay acceso a NATS
- No hay inyección de memoria
- El IDE sigue funcionando — simplemente sin contexto de memoria

---

## Consecuencias

### Positivas

- **Zero-trust by design**: no hay que recordar proteger cada servicio por separado
- **Auditoría completa**: todo lo que hace un agente pasa por un punto identificado
- **Gobernanza centralizada**: capabilities y rate limits se cambian en JBRAIN, no en cada servicio
- **Multi-agente coherente**: el Global Workspace de JBRAIN sabe qué agentes están activos
- **NATS como fabric**: comunicación interna desacoplada, sin point-to-point entre servicios

### Negativas / Trade-offs

- **Complejidad de arranque**: la secuencia de inicialización es más larga
- **Dependencia de JBRAIN**: si JBRAIN cae, los agentes pierden capacidad (mitigado con modo degradado)
- **Nueva infraestructura**: NATS requiere un broker levantado
- **JWT management**: rotación de tokens, TTL, refresh — problema no trivial
- **Latencia en primer token**: ~50-100ms en el arranque (amortizado en toda la sesión)

---

## Alternativas consideradas

### Alt 1: API keys estáticas por servicio
Cada servicio tiene su propia API key que el agente configura en su mcp.json.

**Rechazada porque**: no escala con múltiples agentes, no permite capabilities dinámicas, requiere distribuir secretos a cada cliente, no hay auditoría centralizada.

### Alt 2: No hay enforcement — trust interno
Los servicios internos confían en todo lo que viene de localhost.

**Rechazada porque**: cualquier proceso del sistema puede acceder a la memoria de todos los agentes. No hay aislamiento entre sesiones concurrentes. No escala a un escenario multi-usuario.

### Alt 3: OAuth2 completo con servidor de autorización separado
Un servidor de autorización OAuth2 independiente gestiona los tokens.

**Rechazada en esta fase porque**: demasiado overhead para un sistema inicialmente single-user. El plano de gobernanza de JBRAIN cubre el caso de uso. Se puede migrar a OAuth2 en el futuro si el sistema se hace multi-usuario/multi-tenant.

---

## Relación con el patrón Sidecar

Este diseño es el patrón **Envoy/Istio sidecar** aplicado a agentes AI:

| Service Mesh | Jart-OS |
|-------------|---------|
| Envoy sidecar junto a cada pod | MCP Backpack junto a cada IDE/agente |
| mTLS entre servicios | JWT firmado por JBRAIN |
| Istio control plane | Jart-BRAIN governance plane |
| NATS no tiene equivalente en Istio | Bus de comunicaciones interna |

La diferencia clave: en Jart-OS el sidecar **también es la interfaz de usuario** (tools MCP que el IDE ve). En Istio el sidecar es invisible para la aplicación.

---

## Fases de implementación

| Fase | Alcance de este ADR |
|------|---------------------|
| A–D | Backpack como façade de memoria (diseño anterior). UUID se genera pero no se valida aún. |
| E | JBRAIN implementa el governance plane. Tokens emitidos y validados. |
| F | NATS broker levantado. Backpack gestiona credenciales NATS. Tópicos definidos. |

---

## Referencias

- `ADR-006-jart-brain-cognitive-layer.md` — el plano de gobernanza que emite tokens
- `PHASE-E-jbrain.md` (a crear) — implementación del governance plane
- `PHASE-F-nats-identity.md` (a crear) — NATS + UUID + credenciales
- `ROADMAP.md` — fases E y F añadidas con este ADR
