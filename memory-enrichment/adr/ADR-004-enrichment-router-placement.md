# ADR-004 — Router-Jart como punto único de enriquecimiento

> Estado: PROPUESTO  
> Fecha: 2026-06-08  
> Relacionado: ADR-002, ADR-003

---

## Contexto

La inyección automática de contexto de memoria necesita un punto de intercepción que sea:
1. Universal (funciona para todos los clientes)
2. No invasivo (los clientes no necesitan ser modificados)
3. Confiable (no bloquea si la memoria está caída)
4. Controlable (se puede desactivar, configurar, monitorear)

---

## Decisión

**El `EnrichmentMiddleware` vive en Router-Jart (:10200)**, no en el servidor MCP, no en los clientes individuales.

Router-Jart es el único proxy que todas las peticiones LLM deben cruzar. Es el lugar natural para interceptar, enriquecer y reenviar peticiones sin que ningún cliente sepa que ocurre.

Para clientes que no pasan por Router-Jart en modo interactivo (Claude Code en stdio), se provee un hook mínimo que llama al endpoint `/api/enrich` de Router-Jart. La lógica de enriquecimiento sigue viviendo en Router-Jart — el hook es solo un dispatcher.

---

## Consecuencias

### Positivas
- Claude Code, Cursor, Windsurf, Cowork, cualquier cliente API → enriquecimiento automático sin cambios en el cliente
- Punto único para logging, métricas y configuración del comportamiento de enriquecimiento
- Si se quiere cambiar la estrategia de inyección (formato, budget, score threshold), se cambia en un solo lugar
- El EnrichmentMiddleware puede testearse de forma completamente aislada

### Negativas
- Claude Code en modo stdio interactivo requiere el hook adicional (mínimo, 20 líneas)
- Router-Jart debe estar levantado para que funcione el enriquecimiento (dependencia de disponibilidad)
- Añade ~50-200ms a la latencia de cada petición (mitigado con timeout y cache)

---

## Comportamiento del middleware

```
Petición llega a Router-Jart
        │
        ▼
¿Es POST /v1/chat/completions?  → No → pasar directamente
        │ Sí
        ▼
¿messages contiene mensajes de usuario? → No → pasar directamente
        │ Sí
        ▼
¿Ya contiene [JART-MEMORY en system prompt? → Sí → pasar directamente
        │ No
        ▼
Extraer query signal de los últimos N mensajes
        │
        ▼
POST jart-core-memory/api/context (timeout: 500ms)
        │
        ├── Error/timeout → pasar petición original sin modificar
        │
        └── Respuesta OK con facts
                │
                ▼
        ¿facts.length > 0 AND max_score > min_score?
                │ No → pasar sin modificar
                │ Sí
                ▼
        Inyectar [JART-MEMORY block] al inicio del system prompt
                │
                ▼
        Reenviar petición enriquecida al backend (LiteLLM/vLLM)
```

---

## Configuración

Todas las variables configurables via env vars en Router-Jart:

```env
ENRICHMENT_ENABLED=true
ENRICHMENT_MEMORY_URL=http://localhost:8891
ENRICHMENT_TOKEN_BUDGET=2000
ENRICHMENT_MIN_SCORE=0.65
ENRICHMENT_TIMEOUT_MS=500
ENRICHMENT_CACHE_TTL_S=60
ENRICHMENT_SKIP_AGENT_IDS=embedding-agent,batch-processor
```

---

## Endpoint standalone para hooks de cliente

Además del middleware, Router-Jart expone:

```
POST /api/enrich
```

Para clientes que no pasan por el proxy LLM (ej. Claude Code interactivo). El endpoint aplica la misma lógica de enriquecimiento y devuelve el `injection_text` para que el hook lo inyecte como `systemMessage`.

Este endpoint permite que el comportamiento de enriquecimiento sea **idéntico** entre clientes que pasan por el proxy y clientes que usan hooks.
